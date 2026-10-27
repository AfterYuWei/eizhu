export type { ItemSyncStatus, SyncStatus, SyncConflict, SyncPreview } from '../sync.ts'
export const SYNC_STATUS_LABELS: Record<string, string> = {
  pending_setup: '待接入',
  locked: '待解锁',
  pending: '本地已保存／待同步',
  syncing: '同步中',
  synced: '已同步',
  offline: '离线',
  error: '同步失败',
  conflict: '存在冲突',
  paused: '已暂停',
}

export const SYNC_ITEM_LABELS: Record<string, string> = {
  profile: '服务器',
  group: '分组',
  vault: '凭据',
  snippet: '命令片段',
}
