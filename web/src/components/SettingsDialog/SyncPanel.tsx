import { invokeCommand } from '@/api/tauri'
import { useEffect, useState } from 'react'
import { CloudSync, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { syncApi } from '@/api/sync'
import { useAccountStore } from '@/store/account'
import { useSyncStore } from '@/store/sync'
import { SYNC_STATUS_LABELS, SYNC_ITEM_LABELS, type SyncConflict, type SyncPreview } from '@/types/sync'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

export function SyncPanel() {
  const status = useSyncStore((s) => s.status)
  const conflicts = useSyncStore((s) => s.conflicts)
  const loggedIn = useAccountStore((s) => s.status?.loggedIn)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<SyncPreview | null>(null)
  const [mode, setMode] = useState<'merge' | 'use_local' | 'use_cloud' | null>(null)
  useEffect(() => { void useSyncStore.getState().refresh() }, [])
  async function run(work: () => Promise<unknown>, message?: string) {
    setBusy(true)
    try { await work(); setPassword(''); await useSyncStore.getState().refresh(); if (message) toast.success(message) }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); await useSyncStore.getState().refresh() }
    finally { setBusy(false) }
  }
  if (!loggedIn) return <div className="settings-section"><div className="settings-section-title"><CloudSync size={14} />云同步</div><p className="settings-field-desc">登录云账号后可接入实时同步。本地数据仍可正常使用。</p></div>
  return <div className="settings-section">
    <div className="settings-section-title"><CloudSync size={14} />账号实时同步</div>
    <div className="backup-card">
      <div className="backup-row">{status ? SYNC_STATUS_LABELS[status.status] ?? status.status : '加载中…'}</div>
      <p className="settings-field-desc">修改立即保存到本地，并异步提交云端。离线时修改保留；同条目冲突需逐条选择。</p>
      <div className="backup-row">待同步 {status?.pendingCount ?? 0} 条 · 冲突 {status?.conflictCount ?? 0} 条</div>
      {status?.lastConfirmed && <p className="settings-field-desc">最近云端确认：{new Date(status.lastConfirmed).toLocaleString()}</p>}
      {status?.lastError && <p role="alert" className="backup-warning">{status.lastError}</p>}
      <Button size="sm" disabled={busy} onClick={() => void run(() => syncApi.syncNow(), '已请求刷新和重试')}><RefreshCw size={14} />刷新／重试</Button>
    </div>
    <div className="backup-card">
      <label htmlFor="sync-password">独立同步密码</label>
      <Input id="sync-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={status?.unlocked ? '输入新密码' : '首次设置或输入已有密码'} />
      <p className="settings-field-desc">密码用于解锁账号数据；各设备使用相同密码。备份密码单独管理。</p>
      <Button disabled={busy || password.length < 6} onClick={() => void run(() => status?.unlocked ? syncApi.changePassword(password) : syncApi.unlock(password), status?.unlocked ? '同步密码已更换' : '账号数据已解锁')}>{status?.unlocked ? '更换同步密码' : '设置／解锁'}</Button>
    </div>
    {status?.unlocked && !status.initialized && <div className="backup-card">
      <Button variant="outline" disabled={busy} onClick={() => void run(() => invokeCommand('workspace_import_local'), '本地空间数据已合并到当前账号空间')}>导入原本地空间</Button>
      <Button disabled={busy} onClick={() => void run(async () => setPreview(await syncApi.preview()))}>预览首次接入</Button>
      {preview && <><p>本地 {preview.localCount} 条 · 云端 {preview.cloudCount} 条</p><div className="backup-row">
        <Button disabled={busy} onClick={() => setMode('merge')}>合并</Button>
        <Button variant="outline" disabled={busy} onClick={() => setMode('use_local')}>使用本地</Button>
        <Button variant="outline" disabled={busy} onClick={() => setMode('use_cloud')}>使用云端</Button>
      </div></>}
    </div>}
    {conflicts.map((c) => <div className="backup-card" key={`${c.itemType}:${c.itemId}`}>
      <p>{c.name || c.itemId} · {SYNC_ITEM_LABELS[c.itemType] ?? c.itemType}</p>
      <p className="settings-field-desc">{c.reason === 'dependency' ? '关联关系无法应用，请先处理依赖条目' : '本地与云端存在不同修改'}{c.localDeleted ? ' · 本地已删除' : ''}{c.remoteDeleted ? ' · 云端已删除' : ''}</p>
      <ConflictDiff conflict={c} />
      <div className="backup-row"><Button disabled={busy} onClick={() => void run(() => syncApi.resolveConflict(c.itemType, c.itemId, 'keep_local', c.remoteRevision), '已保留本地，等待云端确认')}>保留本地</Button><Button variant="outline" disabled={busy} onClick={() => void run(() => syncApi.resolveConflict(c.itemType, c.itemId, 'use_cloud', c.remoteRevision), '已采用云端内容')}>使用云端</Button></div>
    </div>)}
    {status && status.items.filter((i) => i.status !== 'synced').map((i) => <div className="backup-row" key={`${i.itemType}:${i.itemId}`}>{SYNC_ITEM_LABELS[i.itemType] ?? i.itemType} · {i.itemId}{i.deleted ? '（删除）' : ''} · {SYNC_STATUS_LABELS[i.status] ?? i.status}</div>)}
    <AlertDialog open={mode !== null} onOpenChange={(open) => { if (!open) setMode(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认首次接入</AlertDialogTitle><AlertDialogDescription>{mode === 'use_cloud' ? '使用云端内容替换当前账号空间。应用前会保存加密安全快照。' : mode === 'use_local' ? '以当前账号空间的本地内容更新云端。其他设备将重新核对变化。' : '合并不同条目，同条目差异保留双方并提示处理。'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { const selected = mode; setMode(null); if (selected && preview) void run(() => syncApi.bootstrap(preview.token, selected), '接入已完成') }}>确认接入</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}

const FIELD_LABELS: Record<string, string> = { name: '名称', host: '主机', port: '端口', username: '用户名', auth_type: '认证方式', group_id: '分组', vault_id: '凭据', parent_id: '父分组', icon: '图标', sort_order: '排序', type: '类型', remark: '备注', fingerprint: '指纹', tags: '标签', note: '备注', content: '命令内容', description: '描述', is_global: '全局片段' }
function ConflictDiff({ conflict }: { conflict: SyncConflict }) {
  const fields = [...new Set([...Object.keys(conflict.local ?? {}), ...Object.keys(conflict.remote ?? {})])]
  const display = (value: unknown) => value === null || value === undefined ? '—' : typeof value === 'string' ? value || '空' : JSON.stringify(value)
  return <details><summary>查看本地与云端差异</summary>
    <table className="w-full text-xs table-fixed"><thead><tr><th>字段</th><th>本地{conflict.localDeleted ? '（已删除）' : ''}</th><th>云端{conflict.remoteDeleted ? '（已删除）' : ''}</th></tr></thead><tbody>{fields.map((field) => <tr key={field}><td>{FIELD_LABELS[field] ?? field}</td><td className="break-all whitespace-pre-wrap">{display(conflict.local?.[field])}</td><td className="break-all whitespace-pre-wrap">{display(conflict.remote?.[field])}</td></tr>)}</tbody></table>
    {(conflict.itemType === 'vault' || conflict.itemType === 'profile') && <p className="settings-field-desc">密码、私钥及代理密码不在摘要中显示。</p>}
  </details>
}
