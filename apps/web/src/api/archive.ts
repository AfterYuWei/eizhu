import { bridge } from '@/lib/bridge'
import type { BackupPreferences, ProviderConfig } from '@/types/backup'

export const archiveApi = {
  status: () => bridge().backup.status(),
  backupNow: () => bridge().backup.backupNow(),
  settings: () => bridge().backup.getSettings(),
  selectDirectory: () => bridge().backup.selectDirectory(),
  updateSettings: (settings: BackupPreferences, backupPassword?: string) => {
    const {
      scheduled_enabled,
      scheduled_interval_hours,
      scheduled_daily_time,
      auto_backup_enabled,
      change_debounce_seconds,
    } = settings
    return bridge().backup.updateSettings({
      settings: {
        scheduled_enabled,
        scheduled_interval_hours,
        scheduled_daily_time,
        auto_backup_enabled,
        change_debounce_seconds,
      },
      backupPassword: backupPassword || undefined,
    })
  },
  providers: () => bridge().backup.targets(),
  createProvider: (config: ProviderConfig) => bridge().backup.createProvider({ config }),
  updateProvider: (id: string, config: ProviderConfig) => bridge().backup.updateProvider({ id, config }),
  deleteProvider: (id: string) => bridge().backup.deleteProvider({ id }),
  testProvider: (id: string) => bridge().backup.testProvider({ id }),
  oauthURL: (type: 'gdrive' | 'onedrive', providerId: string) =>
    bridge().backup.oauthUrl({ providerType: type, providerId }),
}
