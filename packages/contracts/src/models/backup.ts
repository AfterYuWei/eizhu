export interface BackupPreferences {
  scheduled_enabled: boolean
  scheduled_interval_hours: number
  scheduled_daily_time: string
  auto_backup_enabled: boolean
  change_debounce_seconds: number
}

export interface BackupSettings extends BackupPreferences {
  directory: string | null
  backup_password_set: boolean
}

export interface BackupTargetMeta {
  id: string
  type: ProviderType
  name: string
  enabled: boolean
  authorized?: boolean
  created_at: string
  updated_at: string
}

export interface BackupStatus {
  status: 'idle' | 'backing_up' | 'error'
  last_backup_at: string | null
  last_backup_path: string | null
  last_error: string | null
  providers: BackupTargetMeta[]
}

export type ProviderType = 'webdav' | 's3' | 'gdrive' | 'onedrive'

export interface ProviderConfig {
  type: ProviderType
  name: string
  enabled: boolean
  // WebDAV
  endpoint?: string
  username?: string
  password?: string
  // S3
  s3_endpoint?: string
  s3_region?: string
  s3_bucket?: string
  s3_access_key?: string
  s3_secret_key?: string
  s3_prefix?: string
  s3_path_style?: boolean
  // OAuth (gdrive / onedrive)
  oauth_client_id?: string
  oauth_client_secret?: string
  onedrive_folder?: string
}

export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  webdav: 'WebDAV',
  s3: 'S3 兼容存储',
  gdrive: 'Google Drive',
  onedrive: 'OneDrive',
}
