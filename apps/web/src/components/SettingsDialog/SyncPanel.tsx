import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { CloudSync, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { normalizeCommandError } from '@eizhu/contracts'
import { syncDiagnostic } from '@/lib/syncExperience'
import { writeClipboardText } from '@/lib/clipboard'
import { runDesktopAction } from '@/lib/desktopActions'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { syncApi } from '@/api/sync'
import { useAccountStore } from '@/store/account'
import { useSyncStore } from '@/store/sync'
import { SYNC_STATUS_LABELS, SYNC_ITEM_LABELS, type SyncPreview } from '@/types/sync'
import { ErrorRecovery } from './ErrorRecovery'
import { SyncConflictDialog } from './SyncConflictDialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const MergeMock =
  import.meta.env.DEV && import.meta.env.VITE_EIZHU_MERGE_MOCK === '1'
    ? lazy(() => import('./SyncConflictMock'))
    : null

export function SyncPanel() {
  const { status, conflicts, focusItem } = useSyncStore()
  const account = useAccountStore((s) => s.status)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [includeOffline, setIncludeOffline] = useState(true)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [mockOpen, setMockOpen] = useState(false)
  const [preview, setPreview] = useState<SyncPreview | null>(null),
    [mode, setMode] = useState<'merge' | 'use_local' | 'use_cloud' | null>(null)
  const lock = useRef(false)
  useEffect(() => {
    void useSyncStore.getState().refresh()
  }, [])
  useEffect(() => {
    if (focusItem) setConflictOpen(true)
  }, [focusItem])
  async function run(work: () => Promise<unknown>, message?: string) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      await work()
      await useSyncStore.getState().refresh()
      if (message) toast.success(message)
    } catch (cause) {
      const e = normalizeCommandError(cause)
      setError(e.error)
      if (['PREVIEW_CHANGED', 'PREVIEW_EXPIRED'].includes(e.error.code)) setPreview(null)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const enabled = account?.syncEnabled ?? false
  return (
    <section className="settings-section settings-stack" aria-label="账号条目同步">
      <div className="settings-section-title">
        <CloudSync size={14} />
        账号条目同步
      </div>
      {!account?.loggedIn ? (
        <div className="settings-card">
          <div className="settings-field">
            <div className="settings-field-info">
              <span className="settings-field-label">登录后同步条目</span>
              <p className="settings-field-desc">
                在多台设备间同步服务器、分组、凭据和命令片段。完整版本与第三方备份可独立使用。
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => runDesktopAction('account-settings')}>
              前往登录
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="settings-card">
            <div className="settings-field">
              <div className="settings-field-info">
                <Label htmlFor="account-sync-enabled" className="settings-field-label">
                  自动同步
                </Label>
                <p className="settings-field-desc">
                  暂停期间仍可本地保存，待同步修改会保留。首次接入确认前不上传条目。
                </p>
              </div>
              <Switch
                id="account-sync-enabled"
                checked={enabled}
                disabled={busy}
                onCheckedChange={(value) => void run(() => useAccountStore.getState().setSyncEnabled(value))}
              />
            </div>
            <div className="settings-field">
              <div className="settings-field-info">
                <span className="settings-field-label">
                  {status ? SYNC_STATUS_LABELS[status.status] : '正在读取同步状态…'}
                </span>
                <p className="settings-field-desc">
                  待同步 {status?.pendingCount ?? 0} 条 · 冲突 {status?.conflictCount ?? 0} 条
                  {status?.lastConfirmed
                    ? ` · 最近确认 ${new Date(status.lastConfirmed).toLocaleString()}`
                    : ''}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !enabled || !status?.initialized || !status.unlocked}
                onClick={() => void run(() => syncApi.syncNow())}
              >
                <RefreshCw size={14} />
                立即同步
              </Button>
            </div>
          </div>
          {(error || status?.lastError || account.sessionState === 'reauth_required') && (
            <div className="backup-card">
              <ErrorRecovery
                message={
                  error?.message ||
                  status?.lastError ||
                  (account.sessionState === 'reauth_required' ? '登录已失效，账号本地数据仍保留' : '')
                }
                code={
                  account.sessionState === 'reauth_required'
                    ? 'ACCOUNT_NOT_LOGGED_IN'
                    : error?.code || status?.lastErrorCode
                }
                status={status?.status}
                onRetry={() => void run(() => syncApi.syncNow())}
              />
            </div>
          )}
          {status?.unlocked && !status.initialized && (
            <div className="backup-card" aria-label="首次接入预览">
              <div className="backup-row">
                <Label htmlFor="sync-include-offline">合并原离线空间</Label>
                <Switch
                  id="sync-include-offline"
                  checked={includeOffline}
                  disabled={busy}
                  onCheckedChange={(value) => {
                    setIncludeOffline(value)
                    setPreview(null)
                  }}
                />
              </div>
              <p className="settings-field-desc">
                原离线数据始终保留。预览只读取数据，取消后仍保持登录，确认后才开始同步。
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run(async () => setPreview(await syncApi.preview(includeOffline)))}
              >
                预览首次接入
              </Button>
              {preview && (
                <>
                  <p>
                    离线 {preview.offlineCount} 条 · 账号本地 {preview.accountCount} 条 · 云端{' '}
                    {preview.cloudCount} 条 · 冲突 {preview.conflictCount} 条
                  </p>
                  {preview.conflicts?.map((c, index) => (
                    <p key={`${c.itemType}:${c.itemId}:${index}`} className="settings-field-desc">
                      {SYNC_ITEM_LABELS[c.itemType]} · {c.name} ·{' '}
                      {c.remoteSource === 'offline' ? '离线副本存在差异' : '本地与云端存在差异'}
                      {c.local?.credential_changed ? ' · 敏感内容已变化' : ''}
                    </p>
                  ))}
                  <div className="backup-row">
                    <Button size="sm" disabled={busy} onClick={() => setMode('merge')}>
                      确认合并
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode('use_cloud')}>
                      使用云端
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode('use_local')}>
                      使用本地
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPreview(null)}>
                      取消预览
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
          {!!conflicts.length && (
            <div className="settings-card" aria-label="冲突管理">
              <div className="settings-field">
                <div className="settings-field-info">
                  <span className="settings-field-label">{conflicts.length} 项冲突待处理</span>
                  <p className="settings-field-desc">打开合并工作台，比较本机与云端修改，预览后统一应用。</p>
                </div>
                <Button size="sm" disabled={busy || !status?.unlocked} onClick={() => setConflictOpen(true)}>
                  处理冲突
                </Button>
              </div>
            </div>
          )}
          {!!status?.items.length && (
            <details className="backup-card">
              <summary>查看待同步条目</summary>
              {status.items.map((item) => (
                <p className="settings-field-desc" key={`${item.itemType}:${item.itemId}`}>
                  {SYNC_ITEM_LABELS[item.itemType]} · {item.name || item.itemId}
                  {item.deleted ? '（删除）' : ''} · {SYNC_STATUS_LABELS[item.status]}
                </p>
              ))}
            </details>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void run(async () => {
                await writeClipboardText(syncDiagnostic(status))
                toast.success('已复制脱敏诊断')
              })
            }
          >
            复制脱敏诊断
          </Button>
        </>
      )}
      <SyncConflictDialog
        key={account?.loggedIn ? account.user.id : 'offline'}
        open={conflictOpen && account?.loggedIn === true}
        onOpenChange={setConflictOpen}
      />
      {MergeMock && (
        <>
          <Button size="sm" variant="outline" onClick={() => setMockOpen(true)}>
            预览合并工作台（Mock）
          </Button>
          {mockOpen && (
            <Suspense fallback={null}>
              <MergeMock onOpenChange={setMockOpen} />
            </Suspense>
          )}
        </>
      )}
      <AlertDialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open) setMode(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认首次接入</AlertDialogTitle>
            <AlertDialogDescription>
              {mode === 'use_cloud'
                ? '使用云端内容替换当前账号空间，应用前保存加密安全快照。原离线库保留。'
                : mode === 'use_local'
                  ? '将预览中的本地集合整体替换云端，云端独有条目将提交删除标记。其他设备会重新核对；超出单批上限时会拒绝替换。'
                  : '合并不同条目；同 ID 的不同内容保留为冲突，待你选择。原离线库保留。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const selected = mode
                setMode(null)
                if (selected && preview)
                  void run(async () => {
                    await syncApi.bootstrap(preview.token, selected)
                    setPreview(null)
                  }, '首次接入已确认')
              }}
            >
              确认接入
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
