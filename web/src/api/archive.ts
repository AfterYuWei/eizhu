import { invokeCommand } from './tauri'
import type {
  BackupSettings, BackupStatus, BackupVersion, BackupEvent,
  BackupTargetMeta, ProviderConfig,
} from '@/types/backup'

export const archiveApi = {
  status: () => invokeCommand<BackupStatus>('backup_status'),

  backupNow: () =>
    invokeCommand<{ created: boolean; message?: string; version?: BackupVersion }>('backup_backup_now'),

  versions: () => invokeCommand<BackupVersion[]>('backup_versions'),

  restoreVersion: (id: string) =>
    invokeCommand<{ restored: boolean }>('backup_restore_version', { id }),

  previewVersion: (id: string, password?: string) => invokeCommand<{ token: string; stats: { groups: number; vault: number; profiles: number; snippets: number } }>('backup_preview_version', { id, password }),
  applyRestore: (token: string, mode: 'merge' | 'replace') => invokeCommand<void>('backup_apply_restore', { token, mode }),

  safetyVersions: () => invokeCommand<Array<{ id: string; createdAt: string }>>('backup_safety_versions'),
  previewSafety: (id: string) => invokeCommand<{ token: string; stats: { groups: number; vault: number; profiles: number; snippets: number } }>('backup_preview_safety', { id }),

  previewLegacyAccount: (password: string) => invokeCommand<{ token: string; stats: { groups: number; vault: number; profiles: number; snippets: number } }>('backup_preview_legacy_account', { password }),

  cloudVersions: (providerId: string) => invokeCommand<Array<{ object: string; size: number; createdAt: string }>>('backup_cloud_versions', { providerId }),
  previewCloud: (providerId: string, object: string, password?: string) => invokeCommand<{ token: string; stats: { groups: number; vault: number; profiles: number; snippets: number } }>('backup_preview_cloud', { providerId, object, password }),

  deleteVersion: (id: string, force = false) =>
    invokeCommand<void>('backup_delete_version', { id, force }),

  events: (limit = 50) => invokeCommand<BackupEvent[]>('backup_events', { limit }),

  settings: () => invokeCommand<BackupSettings>('backup_get_settings'),

  updateSettings: (settings: BackupSettings, backupPassword?: string) =>
    invokeCommand<{ saved: boolean }>('backup_update_settings', {
      settings,
      backupPassword: backupPassword || undefined,
    }),

  /** Decrypt and return the stored backup password (for display on demand). */
  revealPassword: () =>
    invokeCommand<{ backup_password: string }>('backup_reveal_password'),

  // Complete backup submission
  syncNow: () => invokeCommand<{ started: boolean }>('backup_submit_latest'),
  push: () => invokeCommand<{ started: boolean }>('backup_push'),

  providers: () => invokeCommand<BackupTargetMeta[]>('backup_targets'),
  createProvider: (cfg: ProviderConfig) =>
    invokeCommand<BackupTargetMeta>('backup_create_provider', { config: cfg }),
  updateProvider: (id: string, cfg: ProviderConfig) =>
    invokeCommand<{ saved: boolean }>('backup_update_provider', { id, config: cfg }),
  deleteProvider: (id: string) => invokeCommand<void>('backup_delete_provider', { id }),
  testProvider: (id: string) =>
    invokeCommand<{ saved: boolean }>('backup_test_provider', { id }),

  // OAuth (M3)
  oauthURL: (type: 'gdrive' | 'onedrive', providerId: string) =>
    invokeCommand<{ url: string }>('backup_oauth_url', {
      providerType: type,
      providerId,
    }),
}
