import { bridge } from '@/lib/bridge'
export const syncApi = {
  status: () => bridge().sync.status(),
  syncNow: () => bridge().sync.now(),
  unlock: (password: string) => bridge().sync.unlock({ password }),
  changePassword: (password: string) => bridge().sync.changePassword({ password }),
  conflicts: () => bridge().sync.conflicts(),
  resolveConflict: (
    itemType: import('@/types/sync').SyncConflict['itemType'],
    itemId: string,
    choice: 'keep_local' | 'use_cloud',
    remoteRevision: number,
  ) => bridge().sync.resolveConflict({ itemType, itemId, choice, remoteRevision }),
  preview: (includeOffline = false) => bridge().sync.preview({ includeOffline }),
  bootstrap: (token: string, mode: 'merge' | 'use_local' | 'use_cloud') =>
    bridge().sync.bootstrap({ token, mode }),
}
