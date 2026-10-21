import { randomUUID } from 'node:crypto'
import { fail, providerConfigSchema } from '@eizhu/contracts'
import type {
  BackupSettings,
  BackupVersion,
  BackupEvent,
  BackupTargetMeta,
} from '@eizhu/contracts/models/backup'
import type { ProviderConfig } from '@eizhu/contracts/models/backup'
import type { LocalStore } from '../database/local-store.ts'

export type Token = { access: string; refresh: string; expires: number }
export type Provider = { meta: BackupTargetMeta; config: ProviderConfig; revision: number; token?: Token }
export const defaults: BackupSettings = {
  sync_mode: 'manual',
  conflict_policy: 'prompt',
  cloud_retention: 'keep_forever',
  local_keep_versions: 20,
  scheduled_enabled: false,
  scheduled_interval_hours: 24,
  scheduled_daily_time: '',
  auto_backup_enabled: false,
  change_debounce_seconds: 10,
  backup_password_set: false,
}
const now = () => new Date().toISOString()
/** Runs exclusively in the SQLite Worker. All related writes share one synchronous transaction. */
export class ArchiveRepository {
  private local: LocalStore
  constructor(local: LocalStore) {
    this.local = local
  }
  private read<T>(key: string, fallback: T): T {
    return this.local.archiveState(key, fallback)
  }
  private write(key: string, value: unknown): void {
    this.local.archiveWrite(key, value)
  }
  settings(): BackupSettings {
    return {
      ...defaults,
      ...this.read<Partial<BackupSettings>>('settings', {}),
      backup_password_set: !!this.password(),
    }
  }
  password(): string {
    return this.read('password', '')
  }
  providers(): Provider[] {
    return this.read('providers', [])
  }
  versions(): BackupVersion[] {
    return this.read('versions', [])
  }
  provider(id: string): Provider {
    return this.providers().find((p) => p.meta.id === id) ?? fail('NOT_FOUND', '备份目标不存在')
  }
  private saveProviders(rows: Provider[]): void {
    this.write('providers', rows)
  }
  event(provider: string, action: string, version: number, success: boolean, error?: string): void {
    const rows = this.read<BackupEvent[]>('events', [])
    rows.unshift({
      id: randomUUID(),
      provider_id: provider,
      action,
      version,
      success,
      error,
      created_at: now(),
    })
    this.write('events', rows.slice(0, 500))
  }
  execute(operation: string, raw?: unknown): unknown {
    const d = (raw ?? {}) as {
      settings: BackupSettings
      backupPassword?: string
      id: string
      config: ProviderConfig
      revision: number
      token: Token
      limit: number
      force: boolean
      bytes: Uint8Array
      hash: string
      origin: string
      providerId: string
      versionId: string
      error?: string
      success: boolean
      version: number
      expectedRevision: number
      passwordTag: string
    }
    return this.local.archiveTransaction(() => {
      switch (operation) {
        case 'archive.identity': {
          let identity = this.read('identity', '')
          if (!identity) this.write('identity', (identity = randomUUID()))
          return identity
        }
        case 'archive.capture':
          return {
            payload: this.local.snapshot(),
            password: this.password(),
            revision: this.local.archiveRevision(),
          }
        case 'archive.revision':
          return this.local.archiveRevision()
        case 'archive.providers':
          return this.providers()
        case 'archive.provider':
          return this.provider(d.id)
        case 'backup.targets':
          return this.providers().map((p) => p.meta)
        case 'backup.getSettings':
          return this.settings()
        case 'archive.password':
          return this.password()
        case 'backup.revealPassword':
          return { backup_password: this.password() }
        case 'backup.updateSettings': {
          if (d.settings.cloud_retention !== 'keep_forever')
            fail('UNSUPPORTED_POLICY', '本阶段云端永久保留，请手动管理云端历史')
          if (d.settings.conflict_policy !== 'prompt')
            fail('UNSUPPORTED_POLICY', '云端版本冲突必须先预览并恢复，不能自动覆盖')
          if (
            (d.settings.auto_backup_enabled || d.settings.scheduled_enabled) &&
            !(d.backupPassword || this.password())
          )
            fail('PASSWORD_REQUIRED', '请先设置备份密码')
          this.write('settings', d.settings)
          if (d.backupPassword !== undefined) this.write('password', d.backupPassword)
          this.event('', 'settings', 0, true)
          return { saved: true }
        }
        case 'backup.createProvider':
        case 'backup.updateProvider': {
          const rows = this.providers(),
            old = operation === 'backup.updateProvider' ? this.provider(d.id) : undefined
          if (!old && rows.length >= 32) fail('LIMIT_REACHED', '最多配置 32 个备份目标')
          if (old && old.config.type !== d.config.type) fail('BAD_REQUEST', '请新增目标以更换存储类型')
          const config = providerConfigSchema.parse({ ...old?.config, ...d.config })
          if (config.type === 'webdav' && !config.endpoint) fail('BAD_REQUEST', '请填写 WebDAV 地址')
          if (config.type === 's3' && (!config.s3_access_key || !config.s3_secret_key || !config.s3_bucket))
            fail('BAD_REQUEST', '请填写 S3 凭据与存储桶')
          if ((config.type === 'gdrive' || config.type === 'onedrive') && !config.oauth_client_id)
            fail('BAD_REQUEST', '请填写 OAuth Client ID')
          const meta: BackupTargetMeta = {
            id: old?.meta.id ?? randomUUID(),
            type: config.type,
            name: config.name,
            enabled: config.enabled,
            authorized: false,
            created_at: old?.meta.created_at ?? now(),
            updated_at: now(),
          }
          const authSame =
            old?.config.oauth_client_id === config.oauth_client_id &&
            old?.config.oauth_client_secret === config.oauth_client_secret
          const token = authSame ? old?.token : undefined
          meta.authorized = !!token
          const next = { meta, config, revision: (old?.revision ?? 0) + 1, token }
          this.saveProviders([...rows.filter((p) => p.meta.id !== meta.id), next])
          const destination = (c: ProviderConfig) =>
            Object.entries(c)
              .filter(([k]) => k !== 'name' && k !== 'enabled')
              .sort(([a], [b]) => a.localeCompare(b))
          if (old && JSON.stringify(destination(old.config)) !== JSON.stringify(destination(config)))
            this.forgetTarget(meta.id)
          return old ? { saved: true } : meta
        }
        case 'backup.deleteProvider':
          this.provider(d.id)
          this.saveProviders(this.providers().filter((p) => p.meta.id !== d.id))
          this.forgetTarget(d.id)
          return
        case 'archive.token': {
          const rows = this.providers(),
            row = this.provider(d.id)
          if (row.revision !== d.revision) fail('TARGET_CHANGED', '备份目标已变化，请重新授权')
          row.token = d.token
          row.meta.authorized = true
          this.saveProviders(rows.map((p) => (p.meta.id === d.id ? row : p)))
          return
        }
        case 'backup.versions':
          return this.versions()
        case 'archive.versionBytes': {
          if (!this.versions().some((v) => v.id === d.id)) fail('NOT_FOUND', '本地版本不存在')
          const bytes = this.read<string | null>(`object:${d.id}`, null)
          if (!bytes) fail('DATA_DECRYPT_FAILED', '本地版本缺失，原记录保留')
          return Buffer.from(bytes, 'base64')
        }
        case 'archive.commit': {
          if (d.expectedRevision !== this.local.archiveRevision() || d.passwordTag !== this.password())
            fail('BACKUP_CHANGED', '数据或备份密码在创建期间变化，请重新创建')
          const rows = this.versions()
          if (rows[0]?.hash === d.hash) {
            this.write('lastBackup', Date.now())
            this.write('backedRevision', d.expectedRevision)
            return { created: false, version: rows[0] }
          }
          if (rows.length >= 1000) fail('LIMIT_REACHED', '本地版本已达 1000 个，请清理旧版本')
          const sequence = this.read('sequence', 0) + 1
          const version: BackupVersion = {
            id: randomUUID(),
            version: sequence,
            hash: d.hash,
            size: d.bytes.byteLength,
            origin: d.origin,
            synced_to: [],
            created_at: now(),
          }
          this.write(`object:${version.id}`, Buffer.from(d.bytes).toString('base64'))
          this.write('sequence', sequence)
          this.write('versions', [version, ...rows])
          this.write('backedRevision', d.expectedRevision)
          this.write('lastBackup', Date.now())
          this.event('', 'backup', sequence, true)
          this.prune()
          return { created: true, version }
        }
        case 'archive.ack': {
          const provider = this.provider(d.providerId)
          if (provider.revision !== d.revision || !provider.meta.enabled)
            fail('TARGET_CHANGED', '目标已变化，上传结果未计为已同步')
          const rows = this.versions(),
            version = rows.find((v) => v.id === d.versionId)
          if (!version) fail('NOT_FOUND', '本地版本已删除，上传结果未计为已同步')
          if (!version.synced_to.includes(d.providerId)) version.synced_to.push(d.providerId)
          this.write('versions', rows)
          this.write('lastSync', now())
          this.event(d.providerId, 'push', version.version, true)
          this.prune()
          return
        }
        case 'archive.event':
          this.event(d.providerId, 'push', d.version ?? 0, d.success, d.error)
          return
        case 'backup.events':
          return this.read<BackupEvent[]>('events', []).slice(0, d.limit)
        case 'archive.lastSync':
          return this.read<string | null>('lastSync', null)
        case 'archive.backedRevision':
          return this.read('backedRevision', -1)
        case 'archive.lastBackup':
          return this.read('lastBackup', 0)
        case 'backup.deleteVersion': {
          const rows = this.versions(),
            version = rows.find((v) => v.id === d.id) ?? fail('NOT_FOUND', '本地版本不存在')
          const targets = this.providers().filter((p) => p.meta.enabled)
          if (!d.force && targets.some((p) => !version.synced_to.includes(p.meta.id)))
            fail('VERSION_NOT_SYNCED', '版本尚未提交到全部目标；确认强制删除后可移除本地副本')
          this.write(
            'versions',
            rows.filter((v) => v.id !== d.id),
          )
          this.local.archiveDelete(`object:${d.id}`)
          this.event('', 'delete', version.version, true)
          return
        }
        default:
          return fail('UNKNOWN_OPERATION', '未知备份存储操作')
      }
    })
  }
  private forgetTarget(id: string): void {
    this.write(
      'versions',
      this.versions().map((v) => ({ ...v, synced_to: v.synced_to.filter((target) => target !== id) })),
    )
  }
  private prune(): void {
    const keep = this.settings().local_keep_versions
    if (!keep) return
    const rows = this.versions(),
      targets = this.providers().filter((p) => p.meta.enabled)
    const remove = rows.slice(keep).filter((v) => targets.every((p) => v.synced_to.includes(p.meta.id)))
    for (const v of remove) this.local.archiveDelete(`object:${v.id}`)
    this.write(
      'versions',
      rows.filter((v) => !remove.some((r) => r.id === v.id)),
    )
  }
}
