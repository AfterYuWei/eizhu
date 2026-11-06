import { Loading } from '@/components/ui/loading'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { InlineError } from '@/components/ui/inline-error'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { TabsContent } from '@/components/ui/tabs'
import { archiveApi } from '@/api/archive'
import type { BackupSettings, BackupStatus } from '@/types/backup'
import { ProviderSection } from './ProviderForm'

export function ArchivePanel() {
  const [settings, setSettings] = useState<BackupSettings | null>(null)
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      const [settings, status] = await Promise.all([archiveApi.settings(), archiveApi.status()])
      setSettings(settings)
      setStatus(status)
      setError('')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      void archiveApi
        .status()
        .then(setStatus)
        .catch((error: unknown) => setError(error instanceof Error ? error.message : String(error)))
    }, 5000)
    return () => window.clearInterval(timer)
  }, [refresh])
  async function run(work: () => Promise<void>) {
    setBusy(true)
    try {
      await work()
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <TabsContent value="backup" className="backup-tab-content">
      {error && (
        <div className="backup-actions">
          <InlineError message={error} />
          <Button variant="outline" onClick={() => void refresh()}>
            重试
          </Button>
        </div>
      )}
      {!settings || !status ? (
        !error && <Loading />
      ) : (
        <>
          <section className="backup-group" aria-labelledby="backup-preferences-title">
            <h2 id="backup-preferences-title">自动备份</h2>
            <div className="backup-card backup-preferences">
              <div className="backup-setting-row backup-directory-row">
                <div className="backup-setting-info">
                  <span className="backup-setting-label">本地备份目录</span>
                  <p className="backup-description backup-directory-path">
                    {settings.directory ?? '请选择保存备份文件的目录'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={busy || status.status === 'backing_up'}
                  onClick={() =>
                    void run(async () => {
                      await archiveApi.selectDirectory()
                    })
                  }
                >
                  选择目录
                </Button>
              </div>
              <div className="backup-setting-row">
                <div className="backup-setting-info">
                  <label htmlFor="backup-password">备份密码</label>
                  <p className="backup-description">
                    {settings.backup_password_set
                      ? '已设置，留空保留当前密码'
                      : '至少 6 位，用于加密备份文件及导入时解锁'}
                  </p>
                </div>
                <Input
                  id="backup-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={settings.backup_password_set ? '输入新密码以修改' : '设置备份密码'}
                />
              </div>
              <div className="backup-setting-row">
                <div className="backup-setting-info">
                  <label htmlFor="backup-auto">变更及退出时自动备份</label>
                  <p id="backup-auto-hint" className="backup-description">
                    数据变更后及退出应用前，将加密备份文件保存到本地目录
                  </p>
                </div>
                <Switch
                  id="backup-auto"
                  aria-describedby="backup-auto-hint"
                  checked={settings.auto_backup_enabled}
                  disabled={!settings.directory}
                  onCheckedChange={(enabled) => setSettings({ ...settings, auto_backup_enabled: enabled })}
                />
              </div>
              {settings.auto_backup_enabled && (
                <div className="backup-setting-row">
                  <div className="backup-setting-info">
                    <label htmlFor="backup-debounce">变更后等待秒数</label>
                    <p className="backup-description">连续修改合并为一次备份</p>
                  </div>
                  <Input
                    id="backup-debounce"
                    type="number"
                    min={1}
                    max={3600}
                    value={settings.change_debounce_seconds}
                    onChange={(event) =>
                      setSettings({ ...settings, change_debounce_seconds: Number(event.target.value) })
                    }
                  />
                </div>
              )}
              <div className="backup-setting-row">
                <div className="backup-setting-info">
                  <label htmlFor="backup-scheduled">定时备份</label>
                  <p className="backup-description">按时间间隔或每日指定时间生成备份文件</p>
                </div>
                <Switch
                  id="backup-scheduled"
                  checked={settings.scheduled_enabled}
                  disabled={!settings.directory}
                  onCheckedChange={(enabled) => setSettings({ ...settings, scheduled_enabled: enabled })}
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
                      max={8760}
                      value={settings.scheduled_interval_hours}
                      onChange={(event) =>
                        setSettings({ ...settings, scheduled_interval_hours: Number(event.target.value) })
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
                      onChange={(event) =>
                        setSettings({ ...settings, scheduled_daily_time: event.target.value })
                      }
                    />
                    <p className="backup-description">使用系统时区</p>
                  </div>
                </div>
              )}
              <div className="backup-card-footer">
                <p className="backup-description">备份文件可通过“文件导入与导出”导入。</p>
                <Button
                  disabled={busy || status.status === 'backing_up' || (!!password && password.length < 6)}
                  onClick={() =>
                    void run(async () => {
                      await archiveApi.updateSettings(settings, password || undefined)
                      setPassword('')
                      toast.success('备份设置已保存')
                    })
                  }
                >
                  保存备份设置
                </Button>
              </div>
            </div>
          </section>
          <section className="backup-group" aria-labelledby="backup-status-title">
            <h2 id="backup-status-title">备份状态</h2>
            <div className="backup-card backup-overview">
              <div className="backup-setting-row">
                <div className="backup-setting-info">
                  <span className="backup-setting-label">
                    {status.status === 'backing_up'
                      ? '正在备份…'
                      : status.last_backup_at
                        ? `最近备份：${new Date(status.last_backup_at).toLocaleString()}`
                        : '尚未生成自动备份'}
                  </span>
                  {status.last_backup_path && (
                    <p className="backup-description backup-directory-path">{status.last_backup_path}</p>
                  )}
                </div>
                <Button
                  disabled={
                    busy ||
                    status.status === 'backing_up' ||
                    !settings.directory ||
                    !settings.backup_password_set
                  }
                  onClick={() =>
                    void run(async () => {
                      const result = await archiveApi.backupNow()
                      if (result.failed) toast.warning('本地备份已保存，部分云目标上传失败')
                      else
                        toast.success(
                          result.uploaded
                            ? `本地备份已保存，并上传到 ${result.uploaded} 个云目标`
                            : '本地备份已保存',
                        )
                    })
                  }
                >
                  立即备份
                </Button>
              </div>
              {status.last_error && (
                <div className="backup-status-error">
                  <InlineError message={status.last_error} />
                </div>
              )}
            </div>
          </section>
          <section className="backup-group backup-cloud-card" aria-label="云存储配置">
            <ProviderSection providers={status.providers} onChanged={() => void refresh()} />
            <p className="backup-description backup-cloud-note">
              每次备份同时上传到已启用的云目标。已有云端文件保留。
            </p>
          </section>
        </>
      )}
    </TabsContent>
  )
}
