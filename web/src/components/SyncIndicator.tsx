import { useSyncStore } from '@/store/sync'
import { useAccountStore } from '@/store/account'
import { SYNC_STATUS_LABELS } from '@/types/sync'
import { syncApi } from '@/api/sync'
export function SyncIndicator() {
  const status = useSyncStore((s) => s.status)
  const loggedIn = useAccountStore((s) => s.status?.loggedIn)
  if (!loggedIn || !status) return null
  return <button type="button" className="text-xs text-muted-foreground px-2" title={status.lastError || '本地修改安全保存，点击刷新云端状态'} onClick={() => void syncApi.syncNow().catch(() => {})} aria-live="polite">
    {SYNC_STATUS_LABELS[status.status] ?? status.status}{status.pendingCount > 0 ? ` · 待同步 ${status.pendingCount}` : ''}{status.conflictCount > 0 ? ` · 冲突 ${status.conflictCount}` : ''}
  </button>
}
export function ItemSyncBadge({ type, id }: { type: string; id: string }) {
  const status = useSyncStore((s) => s.status)
  const loggedIn = useAccountStore((s) => s.status?.loggedIn)
  const conflict = useSyncStore((s) => s.conflicts.find((c) => c.itemType === type && c.itemId === id))
  if (!loggedIn || !status) return null
  const item = status.items.find((i) => i.itemType === type && i.itemId === id)
  const label = conflict ? '存在冲突' : item ? SYNC_STATUS_LABELS[item.status] ?? item.status : status.initialized ? '已同步' : '待接入'
  return <span className="text-[10px] text-muted-foreground ml-1" title={label} aria-label={label}>{item || conflict ? '●' : status.initialized ? '✓' : '○'}</span>
}
