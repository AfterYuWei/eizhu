import { bridge } from '@/lib/bridge'
import type { BackupSettings, ProviderConfig } from '@/types/backup'

export const archiveApi = {
  status: () => bridge().backup.status(),

  backupNow: () => bridge().backup.backupNow(),

  versions: () => bridge().backup.versions(),

  restoreVersion: (id: string) => bridge().backup.restoreVersion({ id }),

  previewVersion: (id: string, password?: string) => bridge().backup.previewVersion({ id, password }),
  applyRestore: (token: string, mode: 'merge' | 'replace') => bridge().backup.applyRestore({ token, mode }),

  safetyVersions: () => bridge().backup.safetyVersions(),
  previewSafety: (id: string) => bridge().backup.previewSafety({ id }),

  previewLegacyAccount: (password: string) => bridge().backup.previewLegacyAccount({ password }),

  cloudVersions: (providerId: string) => bridge().backup.cloudVersions({ providerId }),
  previewCloud: (providerId: string, object: string, password?: string) =>
    bridge().backup.previewCloud({ providerId, object, password }),

  deleteVersion: (id: string, force = false) => bridge().backup.deleteVersion({ id, force }),

  events: (limit = 50) => bridge().backup.events({ limit }),

  settings: () => bridge().backup.getSettings(),

  updateSettings: (settings: BackupSettings, backupPassword?: string) =>
    bridge().backup.updateSettings({
      settings,
      backupPassword: backupPassword || undefined,
    }),

  /** Decrypt and return the stored backup password (for display on demand). */
  revealPassword: () => bridge().backup.revealPassword(),

  // Complete backup submission
  syncNow: () => bridge().backup.submitLatest(),
  push: () => bridge().backup.push(),

  providers: () => bridge().backup.targets(),
  createProvider: (cfg: ProviderConfig) => bridge().backup.createProvider({ config: cfg }),
  updateProvider: (id: string, cfg: ProviderConfig) => bridge().backup.updateProvider({ id, config: cfg }),
  deleteProvider: (id: string) => bridge().backup.deleteProvider({ id }),
  testProvider: (id: string) => bridge().backup.testProvider({ id }),

  // OAuth (M3)
  oauthURL: (type: 'gdrive' | 'onedrive', providerId: string) =>
    bridge().backup.oauthUrl({
      providerType: type,
      providerId,
    }),
}
