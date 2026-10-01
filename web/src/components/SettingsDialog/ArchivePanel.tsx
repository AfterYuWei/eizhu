import { useAccountStore } from '@/store/account'
import { useCallback, useEffect, useState } from 'react'
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
  const [restore, setRestore] = useState<BackupVersion | null>(null)
  const refresh = useCallback(async () => {
    try { const [s, st, vs, safety] = await Promise.all([archiveApi.settings(), archiveApi.status(), archiveApi.versions(), archiveApi.safetyVersions()]); setSettings(s); setStatus(st); setVersions(vs); setSafety(safety) }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      void Promise.all([archiveApi.versions(), archiveApi.events()]).then(([vs, events]) => { setVersions(vs); setEvents(events) }).catch(() => {})
    }, 5000)
    return () => window.clearInterval(timer)
  }, [refresh])
  async function run(work: () => Promise<unknown>, message: string) {
    setBusy(true)
    try { await work(); toast.success(message); await refresh() }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  if (!settings || !status) return <p>加载备份配置…</p>
  return <div className="settings-section">
    <div className="settings-section-title">完整版本与云备份</div>
    <p className="settings-field-desc">每次提交当前最新完整版本，各备份目标独立处理。备份可在未登录账号时使用。</p>
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
    <Input type="password" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} aria-label="本地旧版本恢复密码" placeholder="旧版本可输入原备份密码，留空使用当前密码" />
    {versions.map((v) => <div className="backup-card" key={v.id}><div className="backup-row">v{v.version} · {formatSize(v.size)} · {new Date(v.created_at).toLocaleString()} · 已提交 {v.synced_to.length} 个目标</div><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => { setPreview(await archiveApi.previewVersion(v.id, restorePassword || undefined)); setRestore(v) }, "备份预览已准备")}>恢复预览</Button></div>)}
    <div className="backup-card"><label htmlFor="cloud-backup-target">云端备份恢复</label><select id="cloud-backup-target" className="settings-select" value={cloudTarget} onChange={(e) => { setCloudTarget(e.target.value); setCloudVersions([]) }}><option value="">选择备份目标</option>{status.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><Button disabled={busy || !cloudTarget} onClick={() => void run(async () => setCloudVersions(await archiveApi.cloudVersions(cloudTarget)), '已读取云端备份目录')}>查看备份目录</Button><Input type="password" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} aria-label="备份恢复密码" placeholder="留空使用当前备份密码，可输入其他设备的备份密码" />{cloudVersions.map((v) => <div className="backup-row" key={v.object}><span className="truncate" title={v.object}>{v.object} · {formatSize(v.size)}</span><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => { setPreview(await archiveApi.previewCloud(cloudTarget, v.object, restorePassword || undefined)); setRestorePassword(''); setRestore({ id: v.object, version: 0, hash: '', size: v.size, origin: 'cloud', synced_to: [], created_at: v.createdAt }) }, '云端备份已校验，等待确认应用')}>预览恢复</Button></div>)}</div>
    {loggedIn && <div className="backup-card"><label htmlFor="legacy-backup-password">旧账号完整备份接入</label><Input id="legacy-backup-password" type="password" value={legacyPassword} onChange={(e) => setLegacyPassword(e.target.value)} placeholder="旧版本的同步密码" /><p className="settings-field-desc">验证旧完整备份后复制到官方对象存储，预览确认后合并或替换本地；随后作为条目实时同步。</p><Button disabled={busy || !legacyPassword} onClick={() => void run(async () => { setPreview(await archiveApi.previewLegacyAccount(legacyPassword)); setLegacyPassword(''); setRestore({ id: 'legacy', version: 0, hash: '', size: 0, origin: 'legacy', synced_to: [], created_at: '' }) }, '旧备份已校验，等待确认应用')}>校验并预览旧账号备份</Button></div>}
    {safety.length > 0 && <><p>覆盖前安全快照（设备密钥保护）</p>{safety.map((v) => <div className="backup-row" key={v.id}>{new Date(v.createdAt).toLocaleString()}<Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => { setPreview(await archiveApi.previewSafety(v.id)); setRestore({ id: v.id, version: 0, hash: '', size: 0, origin: 'safety', synced_to: [], created_at: v.createdAt }) }, '安全快照预览已准备')}>预览恢复</Button></div>)}</>}
    <AlertDialog open={restore !== null} onOpenChange={(open) => { if (!open) setRestore(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>恢复完整版本</AlertDialogTitle><AlertDialogDescription>版本 v{restore?.version}：分组 {preview?.stats.groups}、凭据 {preview?.stats.vault}、服务器 {preview?.stats.profiles}、片段 {preview?.stats.snippets}。仅查看可取消；合并保留其他本地条目，替换采用完整备份内容。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { setRestore(null); if (preview) void run(() => archiveApi.applyRestore(preview.token, 'merge'), '备份内容已恢复到本地，账号同步将异步提交变化') }}>合并到当前空间</AlertDialogAction><AlertDialogAction onClick={() => { setRestore(null); if (preview) void run(() => archiveApi.applyRestore(preview.token, 'replace'), '备份内容已恢复到本地，账号同步将异步提交变化') }}>替换当前空间</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
