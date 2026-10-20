import { normalizeCommandError } from '@/api/tauri'
import { backupDiagnostic, restoreSourceLabel } from '@/lib/syncExperience'
import { writeClipboardText } from '@/lib/clipboard'
import { ErrorRecovery } from './ErrorRecovery'
import { useAccountStore } from '@/store/account'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { archiveApi } from '@/api/archive'
import type { BackupSettings, BackupStatus, BackupVersion } from '@/types/backup'
import { formatSize } from '@/types/backup'
import { ProviderSection } from './ProviderForm'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
export function ArchivePanel() {
  const loggedIn = useAccountStore((s) => s.status?.loggedIn)
  const [cloudTarget, setCloudTarget] = useState('')
  const [cloudVersions, setCloudVersions] = useState<Awaited<ReturnType<typeof archiveApi.cloudVersions>>>([])
  const [restorePassword, setRestorePassword] = useState('')
  const [legacyPassword, setLegacyPassword] = useState('')
  const [settings, setSettings] = useState<BackupSettings | null>(null)
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [versions, setVersions] = useState<BackupVersion[]>([])
  const [events, setEvents] = useState<Awaited<ReturnType<typeof archiveApi.events>>>([])
  const [safety, setSafety] = useState<Array<{ id: string; createdAt: string }>>([])
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof archiveApi.previewVersion>> | null>(null)
  const [errorCode, setErrorCode] = useState('')
  const lastOperation = useRef<{ work: () => Promise<unknown>; message: string } | null>(null)
  const refresh = useCallback(async () => {
    try { const [s, st, vs, safety] = await Promise.all([archiveApi.settings(), archiveApi.status(), archiveApi.versions(), archiveApi.safetyVersions()]); setSettings(s); setStatus(st); setVersions(vs); setSafety(safety) }
    catch (e) { setErrorCode(normalizeCommandError(e).error.code); toast.error(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      void Promise.all([archiveApi.versions(), archiveApi.events()]).then(([vs, events]) => { setVersions(vs); setEvents(events) }).catch(() => {})
    }, 5000)
    return () => window.clearInterval(timer)
  }, [refresh])
  async function run(work: () => Promise<unknown>, message: string) {
    lastOperation.current = { work, message }; setBusy(true); setErrorCode('')
    try { await work(); toast.success(message); await refresh() }
    catch (e) { setErrorCode(normalizeCommandError(e).error.code); toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  if (!settings || !status) return errorCode ? <ErrorRecovery code={errorCode} onRetry={() => void refresh()} /> : <p>加载备份配置…</p>
  return <div className="settings-section">
    <div className="settings-section-title">完整版本与云备份</div>
    <p className="settings-field-desc">每次提交当前最新完整版本，各备份目标独立处理。备份可在未登录账号时使用。</p>
    {errorCode && <ErrorRecovery code={errorCode} unlockId={errorCode === 'INVALID_PASSWORD' ? 'backup-restore-password' : 'backup-password'} onRetry={() => { const op = lastOperation.current; if (op && !busy) void run(op.work, op.message) }} />}
    <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => writeClipboardText(backupDiagnostic(status, events)), '已复制脱敏备份诊断')}>复制脱敏诊断</Button>
    <ProviderSection providers={status.providers} onChanged={() => void refresh()} />
    <div className="backup-card">
      <label htmlFor="backup-password">备份密码{settings.backup_password_set ? '（已设置）' : ''}</label>
      <Input id="backup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位；与同步密码独立" />
      <div className="backup-row">变更后自动备份<Switch checked={settings.auto_backup_enabled} onCheckedChange={(v) => setSettings({ ...settings, auto_backup_enabled: v })} /></div>
      <div className="backup-row">定时备份<Switch checked={settings.scheduled_enabled} onCheckedChange={(v) => setSettings({ ...settings, scheduled_enabled: v })} /></div>
      {settings.scheduled_enabled && <div className="backup-row"><label htmlFor="backup-interval">间隔（小时，0 关闭）</label><Input id="backup-interval" type="number" min={0} value={settings.scheduled_interval_hours} onChange={(e) => setSettings({ ...settings, scheduled_interval_hours: Number(e.target.value) })} /></div>}
      <div className="backup-row"><label htmlFor="backup-retention">本地保留版本数</label><Input id="backup-retention" type="number" min={0} value={settings.local_keep_versions} onChange={(e) => setSettings({ ...settings, local_keep_versions: Number(e.target.value) })} /></div>
      <p className="settings-field-desc">云端默认永久保留，本地默认保留 20 个版本。</p>
      <Button disabled={busy || (!!password && password.length < 6)} onClick={() => void run(async () => { await archiveApi.updateSettings({ ...settings, sync_mode: 'auto', conflict_policy: 'prompt' }, password || undefined); setPassword('') }, '备份设置已保存')}>保存备份设置</Button>
    </div>
    <div className="backup-row"><Button disabled={busy || !settings.backup_password_set} onClick={() => void run(() => archiveApi.backupNow(), '当前完整版本已准备')}>创建完整版本</Button><Button disabled={busy || !settings.backup_password_set} onClick={() => void run(() => archiveApi.syncNow(), '已请求提交最新完整版本')}>提交最新版本</Button></div>
    {status.providers.map((target) => {
      const event = events.find((e) => e.provider_id === target.id && e.action === 'push')
      return event ? <p key={target.id} role={event.success ? 'status' : 'alert'} className="settings-field-desc">{target.name} · v{event.version} · {event.success ? '已提交' : `提交失败，等待独立重试：${event.error || '云端暂时不可用'}`}</p> : null
    })}
    <Input id="backup-restore-password" type="password" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} aria-label="本地旧版本恢复密码" placeholder="旧版本可输入原备份密码，留空使用当前密码" />
    {versions.map((v) => <div className="backup-card" key={v.id}><div className="backup-row">v{v.version} · {formatSize(v.size)} · {new Date(v.created_at).toLocaleString()} · 已提交 {v.synced_to.length} 个目标</div><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => { setPreview(await archiveApi.previewVersion(v.id, restorePassword || undefined)); setRestorePassword('') }, "备份预览已准备")}>恢复预览</Button></div>)}
    <div className="backup-card"><label htmlFor="cloud-backup-target">云端备份恢复</label><select id="cloud-backup-target" className="settings-select" value={cloudTarget} onChange={(e) => { setCloudTarget(e.target.value); setCloudVersions([]) }}><option value="">选择备份目标</option>{status.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><Button disabled={busy || !cloudTarget} onClick={() => void run(async () => setCloudVersions(await archiveApi.cloudVersions(cloudTarget)), '已读取云端备份目录')}>查看备份目录</Button><Input type="password" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} aria-label="备份恢复密码" placeholder="留空使用当前备份密码，可输入其他设备的备份密码" />{cloudVersions.map((v) => <div className="backup-row" key={v.object}><span className="truncate" title={v.object}>{v.object} · {formatSize(v.size)}</span><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => { setPreview(await archiveApi.previewCloud(cloudTarget, v.object, restorePassword || undefined)); setRestorePassword('') }, '云端备份已校验，等待确认应用')}>预览恢复</Button></div>)}</div>
    {loggedIn && <div className="backup-card"><label htmlFor="legacy-backup-password">旧账号完整备份接入</label><Input id="legacy-backup-password" type="password" value={legacyPassword} onChange={(e) => setLegacyPassword(e.target.value)} placeholder="旧版本的同步密码" /><p className="settings-field-desc">校验并预览旧完整备份；确认后合并或替换本地，再通过条目实时同步。取消预览保留当前空间。</p><Button disabled={busy || !legacyPassword} onClick={() => void run(async () => { setPreview(await archiveApi.previewLegacyAccount(legacyPassword)); setLegacyPassword('') }, '旧备份已校验，等待确认应用')}>校验并预览旧账号备份</Button></div>}
    {safety.length > 0 && <><p>覆盖前安全快照（设备密钥保护）</p>{safety.map((v) => <div className="backup-row" key={v.id}>{new Date(v.createdAt).toLocaleString()}<Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => { setPreview(await archiveApi.previewSafety(v.id)) }, '安全快照预览已准备')}>预览恢复</Button></div>)}</>}
    <AlertDialog open={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>恢复完整版本</AlertDialogTitle><AlertDialogDescription>{preview && restoreSourceLabel(preview.source)}。仅查看可取消；合并保留其他本地条目，替换采用完整备份内容。</AlertDialogDescription></AlertDialogHeader>
      {preview && <div className="space-y-2 text-xs">
        <p>导出时间：{preview.exportedAt || preview.source.createdAt || '未记录'} · 凭据：{preview.credentialMode === 'none' ? '不包含' : preview.credentialMode === 'plain' ? '明文备份' : '加密保护'}</p>
        <table className="w-full"><thead><tr><th>类型</th><th>新增</th><th>变更</th><th>相同</th><th>替换时移除</th></tr></thead><tbody>{([['groups', '分组'], ['vault', '凭据'], ['profiles', '服务器'], ['snippets', '片段']] as const).map(([key, label]) => <tr key={key}><td>{label}</td><td>{preview.changes[key].added}</td><td>{preview.changes[key].changed}</td><td>{preview.changes[key].unchanged}</td><td>{preview.changes[key].removedInReplace}</td></tr>)}</tbody></table>
      </div>}
      <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { const token = preview?.token; setPreview(null); if (token) void run(() => archiveApi.applyRestore(token, 'merge'), '备份已恢复到本地，云端确认会单独显示') }}>合并到当前空间</AlertDialogAction><AlertDialogAction onClick={() => { const token = preview?.token; setPreview(null); if (token) void run(() => archiveApi.applyRestore(token, 'replace'), '备份已恢复到本地，云端确认会单独显示') }}>替换当前空间</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
