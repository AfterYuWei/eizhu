import { bridge } from '@/lib/bridge'
export const syncApi = {
  status: () => bridge().sync.status(),
  syncNow: () => bridge().sync.now(),
  conflicts: () => bridge().sync.conflicts(),
  revealConflictCredentials: (input: import('@eizhu/contracts').SyncRevealCredentials) =>
    bridge().sync.revealConflictCredentials(input),
  resolveConflicts: (input: import('@eizhu/contracts').SyncResolveBatch) =>
    bridge().sync.resolveConflicts(input),
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
