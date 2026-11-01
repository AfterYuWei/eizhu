import { randomUUID } from 'node:crypto'
import { fail, providerConfigSchema } from '@eizhu/contracts'
import type {
  BackupSettings,
  BackupPreferences,
  BackupTargetMeta,
  ProviderConfig,
} from '@eizhu/contracts/models/backup'
import type { LocalStore } from '../database/local-store.ts'

export type Token = { access: string; refresh: string; expires: number }
export type Provider = { meta: BackupTargetMeta; config: ProviderConfig; revision: number; token?: Token }
export const defaults: BackupSettings = {
  directory: null,
  scheduled_enabled: false,
  scheduled_interval_hours: 24,
  scheduled_daily_time: '',
  auto_backup_enabled: false,
  change_debounce_seconds: 10,
  backup_password_set: false,
}
const now = () => new Date().toISOString()
/** Only settings, credentials and the last backup result are kept in SQLite; backup files live in the selected directory. */
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
      ...this.read<Partial<BackupPreferences>>('settings', {}),
      directory: this.read<string | null>('directory', null),
      backup_password_set: !!this.password(),
    }
  }
  password(): string {
    return this.read('password', '')
  }
  providers(): Provider[] {
    return this.read('providers', [])
  }
  provider(id: string): Provider {
    return this.providers().find((p) => p.meta.id === id) ?? fail('NOT_FOUND', '备份目标不存在')
  }
  private saveProviders(rows: Provider[]): void {
    this.write('providers', rows)
  }
  execute(operation: string, raw?: unknown): unknown {
    const d = (raw ?? {}) as {
      settings: BackupPreferences
      backupPassword?: string
      directory: string
      id: string
      config: ProviderConfig
      revision: number
      token: Token
      path: string
      at: string
      error: string | null
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
            revision: this.local.dataRevision(),
            directory: this.settings().directory,
          }
        case 'archive.revision':
          return this.local.dataRevision()
        case 'archive.providers':
          return this.providers()
        case 'archive.provider':
          return this.provider(d.id)
        case 'archive.setDirectory':
          this.write('directory', d.directory)
          return
        case 'backup.targets':
          return this.providers().map((p) => p.meta)
        case 'backup.getSettings':
          return this.settings()
        case 'backup.updateSettings': {
          if (d.settings.auto_backup_enabled || d.settings.scheduled_enabled) {
            if (!this.settings().directory) fail('BACKUP_DIRECTORY_REQUIRED', '请先选择本地备份目录')
            if (!(d.backupPassword || this.password())) fail('PASSWORD_REQUIRED', '请先设置备份密码')
          }
          this.write('settings', d.settings)
          if (d.backupPassword !== undefined) this.write('password', d.backupPassword)
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
          return old ? { saved: true } : meta
        }
        case 'backup.deleteProvider':
          this.provider(d.id)
          this.saveProviders(this.providers().filter((p) => p.meta.id !== d.id))
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

        case 'archive.recordBackup':
          this.write('lastBackup', d.at)
          this.write('lastPath', d.path)
          this.write('backedRevision', d.revision)
          return
        case 'archive.recordResult':
          this.write('lastError', d.error)
          return
        case 'archive.lastBackup':
          return this.read<string | null>('lastBackup', null)
        case 'archive.backedRevision':
          return this.read('backedRevision', -1)
        case 'archive.lastResult':
          return {
            last_backup_at: this.read<string | null>('lastBackup', null),
            last_backup_path: this.read<string | null>('lastPath', null),
            last_error: this.read<string | null>('lastError', null),
          }
        default:
          return fail('UNKNOWN_OPERATION', '未知备份存储操作')
      }
    })
  }
}
