import { createHash } from 'node:crypto'
import { archive, fail } from '@eizhu/contracts'
import type { ArchiveOperation, CloudIndex } from '@eizhu/contracts'
import type {
  BackupSettings,
  BackupVersion,
  BackupStatus,
  RestorePreview,
} from '@eizhu/contracts/models/backup'
import type { Payload } from '../local/model.ts'
import type { WorkerClient } from '../workers/client.ts'
import type { decodeBackup } from '../local/backup.ts'
import type { Provider } from './repository.ts'
import type { Transport } from './network.ts'
import { successful } from './network.ts'
import { CloudProvider } from './providers.ts'
import { scheduledDue } from './schedule.ts'
import { OAuthManager } from './oauth.ts'
const info = (v: BackupVersion) => ({
  version: v.version,
  hash: v.hash,
  size: v.size,
  created_at: v.created_at,
})
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export class ArchiveService {
  private database: WorkerClient
  private compute: WorkerClient
  private network: Transport
  private remember: (token: string) => void
  private controller = new AbortController()
  private oauth: OAuthManager
  private timer: NodeJS.Timeout
  private closing = false
  private work?: Promise<unknown>
  private background?: Promise<void>
  private tickWork?: Promise<void>
  private closeWork?: Promise<void>
  private checking = false
  private operations = new Set<Promise<unknown>>()
  private cloudLatest: BackupStatus['cloud_latest'] = {}
  private conflict: BackupStatus['conflict'] = null
  private state: BackupStatus['status'] = 'idle'
  private seenRevision = -1
  private changedAt = Date.now()
  private lastAttempt = 0
  constructor(
    database: WorkerClient,
    compute: WorkerClient,
    network: Transport,
    remember: (token: string) => void,
  ) {
    this.database = database
    this.compute = compute
    this.network = network
    this.remember = remember
    this.oauth = new OAuthManager(database, network, this.controller.signal)
    this.timer = setInterval(() => {
      if (!this.tickWork)
        this.tickWork = this.tick().finally(() => {
          this.tickWork = undefined
        })
    }, 1000)
    this.timer.unref()
  }
  private async provider(id: string): Promise<CloudProvider> {
    const row = await this.database.call<Provider>('archive.provider', { id })
    const identity = await this.database.call<string>('archive.identity')
    return new CloudProvider(row, `offline-${identity}`, this.network, this.controller.signal, () =>
      this.oauth.access(row),
    )
  }
  async execute(operation: ArchiveOperation, raw: unknown): Promise<unknown> {
    if (this.operations.size >= 8) fail('QUEUE_FULL', '备份请求过多，请稍后重试')
    if (this.closing) fail('BACKUP_STOPPED', '备份服务正在关闭')
    const run = this.executeInner(operation, archive[operation].input.parse(raw))
    this.operations.add(run)
    try {
      return archive[operation].output.parse(await run)
    } finally {
      this.operations.delete(run)
    }
  }
  private async executeInner(operation: ArchiveOperation, input: unknown): Promise<unknown> {
    const d = (input ?? {}) as {
      id: string
      providerId: string
      providerType: string
      password?: string
      object: string
    }
    switch (operation) {
      case 'backup.backupNow':
        return this.exclusive(() => this.create('manual'))
      case 'backup.submitLatest':
      case 'backup.push': {
        if (this.work || this.background) fail('BACKUP_BUSY', '备份任务正在执行，请等待完成')
        this.startPush()
        return { started: true }
      }
      case 'backup.status': {
        const [versions, providers, last] = await Promise.all([
          this.database.call<BackupVersion[]>('backup.versions'),
          this.database.call<BackupStatus['providers']>('backup.targets'),
          this.database.call<string | null>('archive.lastSync'),
        ])
        return {
          status: this.state,
          local_latest: versions[0] ? info(versions[0]) : null,
          cloud_latest: this.cloudLatest,
          providers,
          conflict: this.conflict,
          last_sync_at: last,
        }
      }
      case 'backup.previewVersion': {
        const versions = await this.database.call<BackupVersion[]>('backup.versions'),
          version = versions.find((v) => v.id === d.id) ?? fail('NOT_FOUND', '本地版本不存在')
        const bytes = await this.database.call<Uint8Array>('archive.versionBytes', { id: d.id })
        return this.preview(
          bytes,
          d.password,
          {
            kind: 'local_version',
            version: version.version,
            createdAt: version.created_at,
            origin: version.origin,
          },
          version.hash,
        )
      }
      case 'backup.cloudVersions': {
        const provider = await this.provider(d.providerId),
          { index } = await provider.index()
        await this.ensureTarget(provider.row)
        this.updateCloud(d.providerId, index)
        return index.versions
          .sort((a, b) => b.version - a.version)
          .map((v) => ({ object: v.object, size: v.size, createdAt: v.created_at }))
      }
      case 'backup.previewCloud': {
        const provider = await this.provider(d.providerId),
          { index } = await provider.index(),
          version =
            index.versions.find((v) => v.object === d.object) ?? fail('NOT_FOUND', '云端目录中不存在该版本')
        const response = successful(await provider.get(version.object))
        if (response.body.byteLength !== version.size) fail('CLOUD_DATA_INVALID', '云端备份大小与目录不一致')
        await this.ensureTarget(provider.row)
        return this.preview(
          response.body,
          d.password,
          {
            kind: 'cloud',
            version: version.version,
            object: version.object,
            providerName: provider.row.meta.name,
            createdAt: version.created_at,
          },
          version.hash,
        )
      }
      case 'backup.oauthUrl': {
        const row = await this.database.call<Provider>('archive.provider', { id: d.providerId })
        if (row.config.type !== d.providerType) fail('BAD_REQUEST', '授权目标类型不匹配')
        return this.oauth.begin(row)
      }
      case 'backup.testProvider':
        return this.exclusive(async () => {
          await (await this.provider(d.id)).test()
          return { saved: true }
        })
      case 'backup.updateProvider':
      case 'backup.deleteProvider':
      case 'backup.createProvider':
      case 'backup.updateSettings':
      case 'backup.deleteVersion':
        return this.exclusive(async () => {
          const result = await this.database.call(operation, input)
          if (operation === 'backup.updateProvider' || operation === 'backup.deleteProvider') {
            this.oauth.cancel(d.id)
            delete this.cloudLatest[d.id]
            this.conflict = null
          }
          return result
        })
      default:
        return this.database.call(operation, input)
    }
  }
  private async ensureTarget(row: Provider): Promise<void> {
    const current = await this.database.call<Provider>('archive.provider', { id: row.meta.id })
    if (current.revision !== row.revision) fail('TARGET_CHANGED', '备份目标已变化，请重新读取')
  }
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (this.work) fail('BACKUP_BUSY', '备份任务正在执行，请稍后重试')
    const work = run()
    this.work = work
    return work.finally(() => {
      if (this.work === work) this.work = undefined
    })
  }
  private async create(origin: string): Promise<{ created: boolean; version: BackupVersion }> {
    const { payload, password, revision } = await this.database.call<{
      payload: Payload
      password: string
      revision: number
    }>('archive.capture')
    if (!password) fail('PASSWORD_REQUIRED', '请先设置独立备份密码')
    const result = await this.compute.call<{ bytes: Uint8Array; hash: string }>('backup.encode', {
      payload,
      mode: 'encrypted',
      password,
    })
    try {
      return await this.database.call('archive.commit', {
        ...result,
        origin,
        expectedRevision: revision,
        passwordTag: password,
      })
    } finally {
      result.bytes.fill(0)
    }
  }
  private async preview(
    bytes: Uint8Array,
    password: string | undefined,
    source: RestorePreview['source'],
    expectedHash: string,
  ): Promise<RestorePreview> {
    let decoded: Awaited<ReturnType<typeof decodeBackup>> & { payloadHash: string }
    try {
      decoded = await this.compute.call('archive.decode', {
        bytes,
        password: password ?? (await this.database.call('archive.password')),
      })
    } finally {
      bytes.fill(0)
    }
    if (decoded.payloadHash !== expectedHash) fail('CLOUD_DATA_INVALID', '备份内容摘要与版本目录不一致')
    const { conflicts, ...preview } = await this.database.call<RestorePreview & { conflicts: unknown }>(
      'backup.prepare',
      { ...decoded, source },
    )
    void conflicts
    this.remember(preview.token)
    return preview
  }
  private updateCloud(id: string, index: CloudIndex): void {
    const v = [...index.versions].sort((a, b) => b.version - a.version)[0]
    if (v) this.cloudLatest[id] = { version: v.version, hash: v.hash, size: v.size, created_at: v.created_at }
    else delete this.cloudLatest[id]
  }
  private startPush(): void {
    this.state = 'syncing'
    this.conflict = null
    this.background = this.exclusive(async () => {
      const { version } = await this.create('manual'),
        rows = await this.database.call<Provider[]>('archive.providers')
      let failed = false
      // Bounded workers: each target succeeds independently and records its own acknowledgement.
      const enabled = rows.filter((p) => p.meta.enabled)
      for (let i = 0; i < enabled.length; i += 3) {
        await Promise.all(
          enabled.slice(i, i + 3).map(async (row) => {
            try {
              await this.pushTarget(row, version)
            } catch (error) {
              failed = true
              if (!this.controller.signal.aborted)
                await this.database.call('archive.event', {
                  providerId: row.meta.id,
                  version: version.version,
                  success: false,
                  error: this.errorMessage(error),
                })
            }
          }),
        )
      }
      this.state = this.conflict ? 'conflict' : failed ? 'error' : 'idle'
    })
      .then(
        () => undefined,
        async (error) => {
          this.state = 'error'
          if (!this.controller.signal.aborted)
            await this.database.call('archive.event', {
              providerId: '',
              success: false,
              error: this.errorMessage(error),
            })
        },
      )
      .finally(() => {
        this.background = undefined
      })
  }
  private errorMessage(error: unknown): string {
    const code = (error as { error?: { code?: string } })?.error?.code
    const messages: Record<string, string> = {
      BACKUP_CONFLICT: '云端版本冲突，请先预览并恢复',
      TARGET_CHANGED: '目标已变化，结果未确认',
      CLOUD_AUTH_REQUIRED: '认证失败，请检查凭据或重新授权',
      CLOUD_RATE_LIMITED: '云端限流，请稍后重试',
      BACKUP_CHANGED: '本地数据变化，请重新创建版本',
      PASSWORD_REQUIRED: '请先设置备份密码',
      CLOUD_PRECONDITION_UNSUPPORTED:'目标未提供 ETag，无法安全更新目录',
      CLOUD_DATA_INVALID:'云端目录或对象校验失败，原版本保留',
      CLOUD_REQUEST_FAILED:'云存储请求失败，请检查网络和目标状态',
    }
    return messages[code || ''] || '云备份失败，版本保留；请检查网络、凭据和目标状态后手动重试'
  }
  private async pushTarget(row: Provider, version: BackupVersion): Promise<void> {
    if (version.synced_to.includes(row.meta.id)) return
    const provider = await this.provider(row.meta.id),
      before = await provider.index()
    this.updateCloud(row.meta.id, before.index)
    const same = before.index.versions.find((v) => v.version === version.version)
    if ((same && same.hash !== version.hash) || before.index.latest_version > version.version) {
      const cloud = this.cloudLatest[row.meta.id]
      if (cloud)
        this.conflict = {
          provider_id: row.meta.id,
          provider_name: row.meta.name,
          local: info(version),
          cloud,
        }
      fail('BACKUP_CONFLICT', '云端包含不同版本，请先预览')
    }
    const name = `v${String(version.version).padStart(6, '0')}-${version.hash.slice(0, 12)}.eizhubackup`
    const bytes = await this.database.call<Uint8Array>('archive.versionBytes', { id: version.id })
    try {
      const existing = await provider.get(name)
      if (existing.status === 404) await provider.put(name, bytes, null)
      else {
        successful(existing)
        if (digest(existing.body) !== digest(bytes)) fail('BACKUP_CONFLICT', '云端同名对象内容不同')
      }
      const verified = successful(await provider.get(name))
      if (digest(verified.body) !== digest(bytes)) fail('CLOUD_DATA_INVALID', '云端对象读回校验失败')
      const fresh = await provider.index()
      if (JSON.stringify(fresh.index) !== JSON.stringify(before.index))
        fail('BACKUP_CONFLICT', '云端目录在上传期间变化')
      const entry = { ...info(version), object: name },
        index: CloudIndex = {
          ...fresh.index,
          versions: [...fresh.index.versions.filter((v) => v.version !== version.version), entry],
          latest_version: version.version,
          updated_at: new Date().toISOString(),
        }
      // No unconditional index overwrite: existing directories require a server ETag.
      if (fresh.exists && !fresh.etag)
        fail('CLOUD_PRECONDITION_UNSUPPORTED', '目标未提供 ETag，无法安全更新已有目录')
      await provider.put('index.json', Buffer.from(JSON.stringify(index)), fresh.etag)
      const after = await provider.index()
      if (JSON.stringify(after.index) !== JSON.stringify(index)) fail('BACKUP_CONFLICT', '云端目录确认不一致')
      await this.database.call('archive.ack', {
        providerId: row.meta.id,
        revision: row.revision,
        versionId: version.id,
      })
      this.updateCloud(row.meta.id, index)
    } finally {
      bytes.fill(0)
    }
  }
  private async tick(): Promise<void> {
    if (this.closing || this.checking || this.work || this.background) return
    this.checking = true
    try {
      const [s, revision, last, backed] = await Promise.all([
        this.database.call<BackupSettings>('backup.getSettings'),
        this.database.call<number>('archive.revision'),
        this.database.call<number>('archive.lastBackup'),
        this.database.call<number>('archive.backedRevision'),
      ])
      if (revision !== this.seenRevision) {
        this.seenRevision = revision
        this.changedAt = Date.now()
      }
      if (this.closing || !s.backup_password_set || Date.now() - this.lastAttempt < 30000) return
      const due = scheduledDue(s, last)
      const change =
        s.auto_backup_enabled &&
        revision !== backed &&
        Date.now() - this.changedAt >= s.change_debounce_seconds * 1000
      if (!due && !change) return
      this.lastAttempt = Date.now()
      await this.exclusive(() => this.create(due ? 'scheduled' : 'change'))
      if (s.sync_mode === 'auto' && !this.closing) this.startPush()
    } catch {
      this.state = 'error'
    } finally {
      this.checking = false
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
        ...(this.background ? [this.background] : []),
        ...(this.tickWork ? [this.tickWork] : []),
      ])
    })())
  }
  async beforeQuit(): Promise<void> {
    if (this.work || this.background) fail('BACKUP_BUSY', '备份正在执行，请等待完成后再退出')
    const settings = await this.database.call<BackupSettings>('backup.getSettings')
    if (settings.auto_backup_enabled && settings.backup_password_set)
      await this.exclusive(() => this.create('shutdown'))
  }
}
