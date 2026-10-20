export interface ItemSyncStatus {
  itemType: string
  itemId: string
  generation: number
  name?: string
  status: string
  deleted: boolean
}
export interface SyncStatus {
  status: string
  pendingCount: number
  conflictCount: number
  cursor: number
  initialized: boolean
  unlocked: boolean
  lastConfirmed: string | null
  lastError: string
  lastErrorCode?: string
  items: ItemSyncStatus[]
}
export interface SyncConflict {
  itemType: string
  itemId: string
  name: string
  reason: string
  remoteRevision: number
  localDeleted: boolean
  remoteDeleted: boolean
  local?: Record<string, unknown> | null
  remote?: Record<string, unknown> | null
}
export interface SyncPreview { token: string; localCount: number; cloudCount: number }
export const SYNC_STATUS_LABELS: Record<string, string> = {
  pending_setup: '待接入', locked: '待解锁', pending: '本地已保存／待同步',
  syncing: '同步中', synced: '已同步', offline: '离线', error: '同步失败', conflict: '存在冲突',
}

export const SYNC_ITEM_LABELS: Record<string, string> = { profile: '服务器', group: '分组', vault: '凭据', snippet: '命令片段' }
