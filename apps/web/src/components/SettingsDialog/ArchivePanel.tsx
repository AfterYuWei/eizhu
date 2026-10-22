import { Loading } from '@/components/ui/loading'
import { normalizeCommandError } from '@eizhu/contracts'
import { backupDiagnostic, restoreSourceLabel } from '@/lib/syncExperience'
import { writeClipboardText } from '@/lib/clipboard'
import { ErrorRecovery } from './ErrorRecovery'
import { useAccountStore } from '@/store/account'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Archive, Cloud, Copy, History, LockKeyhole, ShieldCheck, Upload } from 'lucide-react'
import { archiveApi } from '@/api/archive'
import type { BackupSettings, BackupStatus, BackupVersion } from '@/types/backup'
import { formatSize } from '@/types/backup'
import { ProviderSection } from './ProviderForm'
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
export function ArchivePanel() {
  const loggedIn = useAccountStore((s) => s.status?.loggedIn)
  const [cloudTarget, setCloudTarget] = useState('')
  const [cloudVersions, setCloudVersions] = useState<Awaited<ReturnType<typeof archiveApi.cloudVersions>>>([])
  const [restorePassword, setRestorePassword] = useState('')
  const [legacyPassword, setLegacyPassword] = useState('')
  const [settings, setSettings] = useState<BackupSettings | null>(null)
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [deleteVersion, setDeleteVersion] = useState<BackupVersion | null>(null)
  const [versions, setVersions] = useState<BackupVersion[]>([])
  const [events, setEvents] = useState<Awaited<ReturnType<typeof archiveApi.events>>>([])
  const [safety, setSafety] = useState<Array<{ id: string; createdAt: string }>>([])
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof archiveApi.previewVersion>> | null>(null)
  const [errorCode, setErrorCode] = useState('')
  const lastOperation = useRef<{ work: () => Promise<unknown>; message: string } | null>(null)
  const refresh = useCallback(async () => {
    try {
      const [s, st, vs, safety] = await Promise.all([
        archiveApi.settings(),
        archiveApi.status(),
        archiveApi.versions(),
        archiveApi.safetyVersions(),
      ])
      setErrorCode('')
      setSettings(s)
      setStatus(st)
      setVersions(vs)
      setSafety(safety)
    } catch (e) {
      const code = normalizeCommandError(e).error.code
      setErrorCode(code)
      if (code !== 'STAGE_NOT_READY') toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      void Promise.all([archiveApi.versions(), archiveApi.events(), archiveApi.status()])
        .then(([vs, events, st]) => {
          setVersions(vs)
          setEvents(events)
          setStatus(st)
        })
        .catch(() => {})
    }, 5000)
    return () => window.clearInterval(timer)
  }, [refresh])
  async function run(work: () => Promise<unknown>, message: string) {
    lastOperation.current = { work, message }
    setBusy(true)
    setErrorCode('')
    try {
      await work()
      toast.success(message)
      await refresh()
    } catch (e) {
      setErrorCode(normalizeCommandError(e).error.code)
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  if (!settings || !status || errorCode === 'STAGE_NOT_READY') {
    const message =
      errorCode === 'STAGE_NOT_READY' ? (
        <p className="backup-description">
          备份服务尚未就绪，请恢复业务进程后重试。官方账号、账号同步与官方云备份待开发，后端部署后再接入。
        </p>
      ) : errorCode ? (
        <ErrorRecovery code={errorCode} onRetry={() => void refresh()} />
      ) : (
        <Loading />
      )
    return (
      <>
        {(['backup', 'restore'] as const).map((tab) => (
          <TabsContent value={tab} key={tab} className="backup-tab-content">
            {message}
          </TabsContent>
        ))}
      </>
    )
  }
  const targets = status.providers.filter((target) => target.type !== 'account')
  const enabledTargets = targets.filter((target) => target.enabled)
  const recovery = errorCode && (
    <ErrorRecovery
      code={errorCode}
      unlockId={errorCode === 'INVALID_PASSWORD' ? 'backup-restore-password' : 'backup-password'}
      onRetry={() => {
        const op = lastOperation.current
        if (op && !busy) void run(op.work, op.message)
      }}
    />
  )
  return (
    <>
      <TabsContent value="backup" className="backup-tab-content">
        {recovery}
        <section className="backup-group" aria-labelledby="backup-overview-title">
          <h2 id="backup-overview-title">本地备份</h2>
          <div className="backup-card backup-overview">
            <div className="backup-setting-row">
              <div className="backup-setting-info">
                <span className="backup-setting-label">完整版本</span>
                <p className="backup-description">
                  {status.local_latest
                    ? `最新 v${status.local_latest.version} · ${new Date(status.local_latest.created_at).toLocaleString()}`
                    : settings.backup_password_set
                      ? '尚无本地备份，创建后可预览并恢复当前空间的数据'
                      : '先在下方设置备份密码，再创建当前空间的完整版本'}
                </p>
              </div>
              <div className="backup-actions">
                <Button
                  disabled={busy || !settings.backup_password_set}
                  onClick={() => void run(() => archiveApi.backupNow(), '当前完整版本已准备')}
                >
                  <Archive size={15} />
                  创建完整版本
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !settings.backup_password_set || enabledTargets.length === 0}
                  onClick={() => void run(() => archiveApi.syncNow(), '已请求提交最新完整版本')}
                >
                  <Upload size={15} />
                  提交最新版本
                </Button>
              </div>
            </div>
            {status.status !== 'idle' && (
              <p
                className="backup-status-message"
                role={status.status === 'error' || status.status === 'conflict' ? 'alert' : 'status'}
              >
                {status.status === 'syncing'
                  ? '正在提交备份，各目标独立处理…'
                  : status.status === 'conflict'
                    ? '云端版本存在冲突，请查看目标状态与诊断。'
                    : '备份提交遇到问题，请查看目标状态与诊断。'}
              </p>
            )}
          </div>
        </section>

        <div className="backup-settings-grid">
          <section className="backup-group" aria-labelledby="backup-preferences-title">
            <h2 id="backup-preferences-title">安全与自动备份</h2>
            <div className="backup-card backup-preferences">
              <div className="backup-setting-row">
                <div className="backup-setting-info">
                  <label htmlFor="backup-password">备份密码</label>
                  <p id="backup-password-hint" className="backup-description">
                    {settings.backup_password_set
                      ? '已设置；留空保留当前密码'
                      : '至少 6 位，用于加密和恢复完整版本'}
                  </p>
                </div>
                <Input
                  id="backup-password"
                  type="password"
                  autoComplete="new-password"
                  aria-describedby="backup-password-hint"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={settings.backup_password_set ? '输入新密码以修改' : '设置备份密码'}
                />
              </div>
              <div className="backup-setting-row">
                <div className="backup-setting-info">
                  <label htmlFor="backup-auto">变更及退出时自动备份</label>
                  <p id="backup-auto-hint" className="backup-description">
                    数据变更后及退出应用前保留完整版本
                  </p>
                </div>
                <Switch
                  id="backup-auto"
                  aria-describedby="backup-auto-hint"
                  checked={settings.auto_backup_enabled}
                  onCheckedChange={(v) => setSettings({ ...settings, auto_backup_enabled: v })}
                />
              </div>
              <div className="backup-setting-row">
                <div className="backup-setting-info">
                  <label htmlFor="backup-scheduled">定时备份</label>
                  <p className="backup-description">按时间间隔或每日指定时间创建版本</p>
                </div>
                <Switch
                  id="backup-scheduled"
                  checked={settings.scheduled_enabled}
                  onCheckedChange={(v) => setSettings({ ...settings, scheduled_enabled: v })}
                />
              </div>
              {settings.scheduled_enabled && (
                <div className="backup-schedule-fields">
                  <div>
                    <label htmlFor="backup-interval">间隔小时数</label>
                    <Input
                      id="backup-interval"
                      type="number"
                      min={0}
                      value={settings.scheduled_interval_hours}
                      onChange={(e) =>
                        setSettings({ ...settings, scheduled_interval_hours: Number(e.target.value) })
                      }
                    />
                    <p className="backup-description">0 表示关闭间隔备份</p>
                  </div>
                  <div>
                    <label htmlFor="backup-daily-time">每日时间</label>
                    <Input
                      id="backup-daily-time"
                      type="time"
                      value={settings.scheduled_daily_time}
                      onChange={(e) => setSettings({ ...settings, scheduled_daily_time: e.target.value })}
                    />
                    <p className="backup-description">使用系统时区</p>
                  </div>
                </div>
              )}
              <div className="backup-setting-row">
                <div className="backup-setting-info">
                  <label htmlFor="backup-auto-push">自动提交到云存储</label>
                  <p className="backup-description">将最新完整版本提交到已启用的第三方目标</p>
                </div>
                <Switch
                  id="backup-auto-push"
                  checked={settings.sync_mode === 'auto'}
                  onCheckedChange={(v) => setSettings({ ...settings, sync_mode: v ? 'auto' : 'manual' })}
                />
              </div>
              <div className="backup-setting-row">
                <div className="backup-setting-info">
                  <label htmlFor="backup-retention">本地保留版本数</label>
                  <p id="backup-retention-hint" className="backup-description">
                    默认 20 个；0 保留全部，最多 1000 个
                  </p>
                </div>
                <Input
                  id="backup-retention"
                  type="number"
                  min={0}
                  max={1000}
                  aria-describedby="backup-retention-hint"
                  value={settings.local_keep_versions}
                  onChange={(e) => setSettings({ ...settings, local_keep_versions: Number(e.target.value) })}
                />
              </div>
              <div className="backup-card-footer">
                <p className="backup-description">云端默认永久保留</p>
                <Button
                  disabled={busy || (!!password && password.length < 6)}
                  onClick={() =>
                    void run(async () => {
                      await archiveApi.updateSettings(
                        { ...settings, conflict_policy: 'prompt' },
                        password || undefined,
                      )
                      setPassword('')
                    }, '备份设置已保存')
                  }
                >
                  保存备份设置
                </Button>
              </div>
            </div>
          </section>
          <section className="backup-group backup-cloud-card" aria-label="云存储配置">
            <ProviderSection providers={status.providers} onChanged={() => void refresh()} />
            {targets.map((target) => {
              const event = events.find((e) => e.provider_id === target.id && e.action === 'push')
              return event ? (
                <p key={target.id} role={event.success ? 'status' : 'alert'} className="backup-description">
                  {target.name} · v{event.version} ·{' '}
                  {event.success ? '已提交' : `提交失败，等待独立重试：${event.error || '云端暂时不可用'}`}
                </p>
              ) : null
            })}
            <p className="backup-description backup-cloud-note">
              第三方云备份无需登录账号。官方账号、同步和官方云备份待开发。
            </p>
          </section>
        </div>
        <div className="backup-page-footer">
          <span className="backup-description">
            <LockKeyhole size={13} />
            请妥善保管备份密码，恢复数据时需要使用。
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(() => writeClipboardText(backupDiagnostic(status, events)), '已复制脱敏备份诊断')
            }
          >
            <Copy size={14} />
            复制脱敏诊断
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="restore" className="backup-tab-content">
        {recovery}
        <section className="backup-card backup-restore-password" aria-labelledby="backup-restore-title">
          <div className="backup-setting-info">
            <h2 id="backup-restore-title">
              <label htmlFor="backup-restore-password">恢复密码</label>
            </h2>
            <p id="backup-restore-hint" className="backup-description">
              留空使用当前密码；旧版本或其他设备的备份可输入原密码。
            </p>
          </div>
          <Input
            id="backup-restore-password"
            type="password"
            aria-describedby="backup-restore-hint"
            value={restorePassword}
            onChange={(e) => setRestorePassword(e.target.value)}
            placeholder="原备份密码（可选）"
          />
        </section>
        <section className="backup-card" aria-labelledby="backup-history-title">
          <div className="backup-section-heading">
            <span className="backup-section-icon">
              <History size={18} />
            </span>
            <div>
              <h2 id="backup-history-title">
                本地版本 <span className="backup-count">{versions.length}</span>
              </h2>
              <p className="backup-description">先预览变化，再选择合并或替换当前空间。</p>
            </div>
          </div>
          {versions.length === 0 ? (
            <div className="backup-empty">
              <History size={24} />
              <p>还没有本地备份版本</p>
              <span className="backup-description">在「备份设置」中创建完整版本后，会显示在这里。</span>
            </div>
          ) : (
            <div className="backup-version-list">
              {versions.map((v) => (
                <div className="backup-version-row" key={v.id}>
                  <span className="backup-version-tag">v{v.version}</span>
                  <div className="backup-version-info">
                    <span>{new Date(v.created_at).toLocaleString()}</span>
                    <span className="backup-description">
                      {formatSize(v.size)} · 已提交 {v.synced_to.length} 个目标
                    </span>
                  </div>
                  <div className="backup-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          setPreview(await archiveApi.previewVersion(v.id, restorePassword || undefined))
                          setRestorePassword('')
                        }, '备份预览已准备')
                      }
                    >
                      恢复预览
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDeleteVersion(v)}>
                      删除本地副本
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="backup-card" aria-labelledby="backup-cloud-restore-title">
          <div className="backup-section-heading">
            <span className="backup-section-icon">
              <Cloud size={18} />
            </span>
            <div>
              <h2 id="backup-cloud-restore-title">从云存储恢复</h2>
              <p className="backup-description">选择存储目标，读取目录并校验需要恢复的版本。</p>
            </div>
          </div>
          {targets.length === 0 ? (
            <p className="backup-description">尚未配置云存储，请先在「备份设置」中添加存储源。</p>
          ) : (
            <div className="backup-cloud-picker">
              <Select
                value={cloudTarget}
                onValueChange={(value) => {
                  setCloudTarget(value)
                  setCloudVersions([])
                }}
              >
                <SelectTrigger id="cloud-backup-target" aria-label="云端备份目标">
                  <SelectValue placeholder="选择备份目标" />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                disabled={busy || !cloudTarget}
                onClick={() =>
                  void run(
                    async () => setCloudVersions(await archiveApi.cloudVersions(cloudTarget)),
                    '已读取云端备份目录',
                  )
                }
              >
                查看备份目录
              </Button>
            </div>
          )}
          {cloudVersions.map((v) => (
            <div className="backup-version-row" key={v.object}>
              <div className="backup-version-info">
                <span className="truncate" title={v.object}>
                  {v.object}
                </span>
                <span className="backup-description">{formatSize(v.size)}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setPreview(
                      await archiveApi.previewCloud(cloudTarget, v.object, restorePassword || undefined),
                    )
                    setRestorePassword('')
                  }, '云端备份已校验，等待确认应用')
                }
              >
                预览恢复
              </Button>
            </div>
          ))}
        </section>
        {loggedIn && (
          <section className="backup-card">
            <h2>
              <label htmlFor="legacy-backup-password">旧账号完整备份接入</label>
            </h2>
            <Input
              id="legacy-backup-password"
              type="password"
              value={legacyPassword}
              onChange={(e) => setLegacyPassword(e.target.value)}
              placeholder="旧版本的同步密码"
            />
            <p className="backup-description">
              校验并预览旧完整备份；确认后合并或替换本地，再通过条目实时同步。取消预览保留当前空间。
            </p>
            <Button
              className="backup-action"
              disabled={busy || !legacyPassword}
              onClick={() =>
                void run(async () => {
                  setPreview(await archiveApi.previewLegacyAccount(legacyPassword))
                  setLegacyPassword('')
                }, '旧备份已校验，等待确认应用')
              }
            >
              校验并预览旧账号备份
            </Button>
          </section>
        )}
        {safety.length > 0 && (
          <section className="backup-card">
            <div className="backup-section-heading">
              <span className="backup-section-icon">
                <ShieldCheck size={18} />
              </span>
              <div>
                <h2>覆盖前安全快照</h2>
                <p className="backup-description">由设备密钥保护，恢复前可预览变化。</p>
              </div>
            </div>
            {safety.map((v) => (
              <div className="backup-version-row" key={v.id}>
                <span>{new Date(v.createdAt).toLocaleString()}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setPreview(await archiveApi.previewSafety(v.id))
                    }, '安全快照预览已准备')
                  }
                >
                  预览恢复
                </Button>
              </div>
            ))}
          </section>
        )}
      </TabsContent>
      <AlertDialog
        open={deleteVersion !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteVersion(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除本地备份副本</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除本地版本 v{deleteVersion?.version}？云端副本会保留。尚未提交的版本可能只有这一份副本。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = deleteVersion?.id
                setDeleteVersion(null)
                if (id) void run(() => archiveApi.deleteVersion(id, true), '本地备份副本已删除')
              }}
            >
              删除本地副本
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>恢复完整版本</AlertDialogTitle>
            <AlertDialogDescription>
              {preview && restoreSourceLabel(preview.source)}
              。仅查看可取消；合并保留其他本地条目，替换采用完整备份内容。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preview && (
            <div className="space-y-2 text-xs">
              <p>
                导出时间：{preview.exportedAt || preview.source.createdAt || '未记录'} · 凭据：
                {preview.credentialMode === 'none'
                  ? '不包含'
                  : preview.credentialMode === 'plain'
                    ? '明文备份'
                    : '加密保护'}
              </p>
              <table className="w-full">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>新增</th>
                    <th>变更</th>
                    <th>相同</th>
                    <th>替换时移除</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['groups', '分组'],
                      ['vault', '凭据'],
                      ['profiles', '服务器'],
                      ['snippets', '片段'],
                    ] as const
                  ).map(([key, label]) => (
                    <tr key={key}>
                      <td>{label}</td>
                      <td>{preview.changes[key].added}</td>
                      <td>{preview.changes[key].changed}</td>
                      <td>{preview.changes[key].unchanged}</td>
                      <td>{preview.changes[key].removedInReplace}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const token = preview?.token
                setPreview(null)
                if (token)
                  void run(
                    () => archiveApi.applyRestore(token, 'merge'),
                    '备份已恢复到本地，云端确认会单独显示',
                  )
              }}
            >
              合并到当前空间
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                const token = preview?.token
                setPreview(null)
                if (token)
                  void run(
                    () => archiveApi.applyRestore(token, 'replace'),
                    '备份已恢复到本地，云端确认会单独显示',
                  )
              }}
            >
              替换当前空间
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
