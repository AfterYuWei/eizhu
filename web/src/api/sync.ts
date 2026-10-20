import { invokeCommand } from './tauri'
import type { SyncStatus, SyncConflict, SyncPreview } from '@/types/sync'
export const syncApi = {
  status: () => invokeCommand<SyncStatus>('sync_status'),
  syncNow: () => invokeCommand<void>('sync_now'),
  unlock: (password: string) => invokeCommand<void>('sync_unlock', { password }),
  changePassword: (password: string) => invokeCommand<void>('sync_change_password', { password }),
  conflicts: () => invokeCommand<SyncConflict[]>('sync_conflicts'),
  resolveConflict: (itemType: string, itemId: string, choice: 'keep_local' | 'use_cloud', remoteRevision: number) =>
    invokeCommand<void>('sync_resolve_conflict', { itemType, itemId, choice, remoteRevision }),
  preview: () => invokeCommand<SyncPreview>('sync_preview'),
  bootstrap: (token: string, mode: 'merge' | 'use_local' | 'use_cloud') =>
    invokeCommand<void>('sync_bootstrap', { token, mode }),
}
