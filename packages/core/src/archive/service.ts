import { createHash } from 'node:crypto'
import { archive, fail } from '@eizhu/contracts'
import type { ArchiveOperation } from '@eizhu/contracts'
import type { BackupSettings, BackupStatus } from '@eizhu/contracts/models/backup'
import type { Payload } from '../local/model.ts'
import type { WorkerClient } from '../workers/client.ts'
import type { Provider } from './repository.ts'
import type { Transport } from './network.ts'
import { successful } from './network.ts'
import { CloudProvider } from './providers.ts'
import { scheduledDue } from './schedule.ts'
import { OAuthManager } from './oauth.ts'
import { backupDirectory, saveBackup } from './files.ts'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export class ArchiveService {
  private controller = new AbortController()
  private oauth: OAuthManager
  private timer: NodeJS.Timeout
  private closing = false
  private work?: Promise<unknown>
  private tickWork?: Promise<void>
  private closeWork?: Promise<void>
  private operations = new Set<Promise<unknown>>()
  private seenRevision = -1
  private changedAt = Date.now()
  private lastAttempt = 0
  private database: WorkerClient
  private compute: WorkerClient
  private network: Transport
  constructor(database: WorkerClient, compute: WorkerClient, network: Transport) {
    this.database = database
    this.compute = compute
    this.network = network
    this.oauth = new OAuthManager(database, network, this.controller.signal)
    this.timer = setInterval(() => {
      if (!this.tickWork)
        this.tickWork = this.tick()
          .catch(() => {
            console.error('自动备份状态保存失败，请检查本地数据库')
          })
          .finally(() => {
            this.tickWork = undefined
          })
    }, 1000)
    this.timer.unref()
  }
  private async provider(row: Provider): Promise<CloudProvider> {
    const identity = await this.database.call<string>('archive.identity')
    return new CloudProvider(row, `offline-${identity}`, this.network, this.controller.signal, () =>
      this.oauth.access(row),
    )
  }
  async selectDirectory(path: string): Promise<string> {
    const directory = await backupDirectory(path)
    await this.exclusive(() => this.database.call('archive.setDirectory', { directory }))
    return directory
  }
  async execute(operation: ArchiveOperation, raw: unknown): Promise<unknown> {
    if (this.operations.size >= 8) fail('QUEUE_FULL', '备份请求过多，请稍后重试')
    if (this.closing) fail('BACKUP_STOPPED', '备份服务正在关闭')
    const run = this.executeInner(operation, raw)
    this.operations.add(run)
    try {
      return archive[operation].output.parse(await run)
    } finally {
      this.operations.delete(run)
    }
  }
  private async executeInner(operation: ArchiveOperation, raw: unknown): Promise<unknown> {
    switch (operation) {
      case 'backup.backupNow':
        archive[operation].input.parse(raw)
        return this.exclusive(() => this.create())
      case 'backup.status': {
        archive[operation].input.parse(raw)
        const [last, providers] = await Promise.all([
          this.database.call<Omit<BackupStatus, 'status' | 'providers'>>('archive.lastResult'),
          this.database.call<BackupStatus['providers']>('backup.targets'),
        ])
        return { ...last, providers, status: this.work ? 'backing_up' : last.last_error ? 'error' : 'idle' }
      }
      case 'backup.oauthUrl': {
        const d = archive[operation].input.parse(raw)
        const row = await this.database.call<Provider>('archive.provider', { id: d.providerId })
        if (row.config.type !== d.providerType) fail('BAD_REQUEST', '授权目标类型不匹配')
        return this.oauth.begin(row)
      }
      case 'backup.testProvider': {
        const d = archive[operation].input.parse(raw)
        return this.exclusive(async () => {
          const row = await this.database.call<Provider>('archive.provider', d)
          await (await this.provider(row)).test()
          return { saved: true }
        })
      }
      case 'backup.updateProvider':
      case 'backup.deleteProvider': {
        const d = archive[operation].input.parse(raw)
        return this.exclusive(async () => {
          const result = await this.database.call(operation, d)
          this.oauth.cancel(d.id)
          return result
        })
      }
      case 'backup.createProvider':
      case 'backup.updateSettings':
        return this.exclusive(() => this.database.call(operation, raw))
      default:
        return this.database.call(operation, raw)
    }
  }
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (this.closing) fail('BACKUP_STOPPED', '备份服务正在关闭')
    if (this.work) fail('BACKUP_BUSY', '备份任务正在执行，请稍后重试')
    const work = run()
    this.work = work
    return work.finally(() => {
      if (this.work === work) this.work = undefined
    })
  }
  private async create(): Promise<{ path: string; uploaded: number; failed: number }> {
    try {
      const { payload, password, revision, directory } = await this.database.call<{
        payload: Payload
        password: string
        revision: number
        directory: string | null
      }>('archive.capture')
      if (!directory) fail('BACKUP_DIRECTORY_REQUIRED', '请先选择本地备份目录')
      if (!password) fail('PASSWORD_REQUIRED', '请先设置独立备份密码')
      const result = await this.compute.call<{ bytes: Uint8Array }>(
        'backup.encode',
        {
          payload,
          mode: 'encrypted',
          password,
        },
        { signal: this.controller.signal },
      )
      try {
        const saved = await saveBackup(directory, result.bytes)
        await this.database.call('archive.recordBackup', {
          revision,
          path: saved.path,
          at: new Date().toISOString(),
        })
        const targets = (await this.database.call<Provider[]>('archive.providers')).filter(
          (p) => p.meta.enabled,
        )
        const errors: string[] = []
        let uploaded = 0
        for (let i = 0; i < targets.length; i += 3) {
          await Promise.all(
            targets.slice(i, i + 3).map(async (row) => {
              try {
                const provider = await this.provider(row)
                // Only touch this new object. Existing cloud backups and their indices are never read or changed.
                await provider.put(saved.name, result.bytes, null)
                const verified = successful(await provider.get(saved.name))
                if (digest(verified.body) !== digest(result.bytes))
                  fail('CLOUD_DATA_INVALID', '上传后的备份校验失败')
                uploaded++
              } catch (error) {
                errors.push(`${row.meta.name}：${this.errorMessage(error)}`)
              }
            }),
          )
        }
        await this.database.call('archive.recordResult', {
          error: errors.length
            ? `本地备份已保存；${errors.length} 个云目标上传失败。${errors.join('；')}`.slice(0, 512)
            : null,
        })
        return { path: saved.path, uploaded, failed: errors.length }
      } finally {
        result.bytes.fill(0)
      }
    } catch (error) {
      if (!this.closing) await this.database.call('archive.recordResult', { error: this.errorMessage(error) })
      throw error
    }
  }
  private errorMessage(error: unknown): string {
    const code = (error as { error?: { code?: string } })?.error?.code
    const messages: Record<string, string> = {
      BACKUP_DIRECTORY_REQUIRED: '请先选择本地备份目录',
      BACKUP_DIRECTORY_INVALID: '本地备份目录不可用，请重新选择',
      PASSWORD_REQUIRED: '请先设置备份密码',
      CLOUD_AUTH_REQUIRED: '认证失败，请检查凭据或重新授权',
      CLOUD_RATE_LIMITED: '云存储限流，请稍后重试',
      CLOUD_DATA_INVALID: '新备份上传校验失败',
      CLOUD_REQUEST_FAILED: '云存储请求失败，请检查网络和目标状态',
      BACKUP_CONFLICT: '新备份上传未确认，请检查目标状态',
    }
    return messages[code ?? ''] ?? '备份未完成，请检查本地目录、磁盘空间和云目标状态后重试'
  }
  private async tick(): Promise<void> {
    if (this.closing || this.work) return
    const [settings, revision, last, backed] = await Promise.all([
      this.database.call<BackupSettings>('backup.getSettings'),
      this.database.call<number>('archive.revision'),
      this.database.call<string | null>('archive.lastBackup'),
      this.database.call<number>('archive.backedRevision'),
    ])
    if (revision !== this.seenRevision) {
      this.seenRevision = revision
      this.changedAt = Date.now()
    }
    if (
      this.closing ||
      this.work ||
      !settings.directory ||
      !settings.backup_password_set ||
      Date.now() - this.lastAttempt < 30000
    )
      return
    const due = scheduledDue(settings, last ? Date.parse(last) : 0)
    const change =
      settings.auto_backup_enabled &&
      revision !== backed &&
      Date.now() - this.changedAt >= settings.change_debounce_seconds * 1000
    if (!due && !change) return
    this.lastAttempt = Date.now()
    try {
      await this.exclusive(() => this.create())
    } catch {
      /* create() records a visible failure; the next scheduled attempt stays bounded. */
    }
  }
  close(): Promise<void> {
    return (this.closeWork ??= (async () => {
      this.closing = true
      clearInterval(this.timer)
      this.oauth.close()
      this.controller.abort()
      await Promise.allSettled([
        ...this.operations,
        ...(this.work ? [this.work] : []),
        ...(this.tickWork ? [this.tickWork] : []),
      ])
    })())
  }
  async beforeQuit(): Promise<void> {
    if (this.work) fail('BACKUP_BUSY', '备份正在执行，请等待完成后再退出')
    const settings = await this.database.call<BackupSettings>('backup.getSettings')
    if (settings.auto_backup_enabled && settings.backup_password_set && settings.directory)
      await this.exclusive(() => this.create())
  }
}
