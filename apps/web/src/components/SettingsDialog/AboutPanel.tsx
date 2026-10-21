import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Info, RefreshCw, Download, ExternalLink } from 'lucide-react'
import { getPlatformCapabilities, isDesktopRuntime } from '@/lib/platform'
import { openExternal } from '@/lib/desktop'
import {
  appVersion,
  buildChannel,
  checkForUpdates,
  downloadAndInstallUpdate,
  releasePage,
  type UpdateCheckResult,
  type UpdateDownloadProgress,
} from '@/lib/updater'
import { useSettingsStore, type UpdateChannel } from '@/store/settings'
import { runUpdateWithToast } from '@/components/UpdateProgressToast'

const channelOptions = [
  { value: 'stable', label: '正式版本通道' },
  { value: 'test', label: '测试版本通道' },
]

/**
 * 「关于」面板：版本信息与应用内更新。
 * 正式/测试更新通道独立，选择会持久化；deb/rpm 安装包不支持应用内更新。
 */
export function AboutPanel() {
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<UpdateDownloadProgress | null>(null)
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const updateChannel = useSettingsStore((state) => state.updateChannel)
  const setUpdateChannel = useSettingsStore((state) => state.setUpdateChannel)

  useEffect(() => {
    void appVersion().then(setVersion)
  }, [])

  const handleCheck = async () => {
    setChecking(true)
    setResult(null)
    setError(null)
    try {
      const checkResult = await checkForUpdates(updateChannel)
      setResult(checkResult)
      if (!checkResult.available) {
        toast.success('已是最新版本')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error('检查更新失败', {
        description: message,
      })
    } finally {
      setChecking(false)
    }
  }

  const handleInstall = () => {
    setDownloading(true)
    setProgress(null)
    setError(null)
    void runUpdateWithToast(
      (onProgress) =>
        downloadAndInstallUpdate(updateChannel, (downloadProgress) => {
          setProgress(downloadProgress)
          onProgress(downloadProgress)
        }),
      { version: result?.newVersion },
    )
      .then((installed) => {
        if (!installed) setResult(null)
      })
      .finally(() => {
        // relaunch 成功则不会走到这里
        setDownloading(false)
      })
  }

  const desktop = isDesktopRuntime()
  const updatesAvailable = getPlatformCapabilities().appUpdates
  const channelLabel = updateChannel === 'stable' ? '正式版' : '测试版'

  return (
    <div className="settings-section">
      <div className="settings-section-title">
        <Info size={14} />
        <span>关于 eizhu</span>
      </div>

      <div className="settings-card">
        <div className="settings-field">
          <div className="settings-field-info">
            <span className="settings-field-label">当前版本</span>
            <span className="settings-field-desc">
              {desktop ? '基于 Electron 的桌面版' : '浏览器模式（网页版）'}
            </span>
          </div>
          <span className="about-version-value">
            {version ? `${version} · ${buildChannel === 'test' ? '测试版' : '正式版'}` : '—'}
          </span>
        </div>

        {desktop && (
          <div className="settings-field">
            <div className="settings-field-info">
              <label htmlFor="settings-update-channel" className="settings-field-label">
                更新通道
              </label>
              <span className="settings-field-desc">正式版优先稳定性；测试版可提前获取最新修复</span>
            </div>
            <Select
              value={updateChannel}
              onValueChange={(value) => {
                setUpdateChannel(value as UpdateChannel)
                setResult(null)
                setError(null)
              }}
              disabled={checking || downloading}
            >
              <SelectTrigger id="settings-update-channel" className="settings-select">
                <SelectValue placeholder="请选择" />
              </SelectTrigger>
              <SelectContent>
                {channelOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {desktop && (
          <div className="settings-field">
            <div className="settings-field-info">
              <span className="settings-field-label">软件更新</span>
              <span className="settings-field-desc" role="status" aria-live="polite">
                {downloading
                  ? progress?.phase === 'installing'
                    ? '正在安装更新，应用即将重启…'
                    : progress?.percent != null
                      ? `正在下载更新… ${Math.floor(progress.percent)}%`
                      : '正在下载更新…'
                  : error
                    ? error
                    : !updatesAvailable
                      ? '当前运行方式不支持应用内更新，请前往版本页面手动安装'
                      : result
                        ? result.available
                          ? `发现新版本 ${result.newVersion}`
                          : `当前已是${channelLabel}通道的最新版本`
                        : `检查并安装${channelLabel}更新`}
              </span>
            </div>
            {result?.available && !downloading ? (
              <Button onClick={handleInstall} className="settings-btn">
                <Download size={13} />
                下载并安装
              </Button>
            ) : (
              <Button
                onClick={() => void handleCheck()}
                disabled={checking || downloading || !updatesAvailable}
                className="settings-btn"
              >
                <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
                {checking ? '检查中…' : '检查更新'}
              </Button>
            )}
          </div>
        )}

        {desktop && (
          <div className="settings-field">
            <div className="settings-field-info">
              <span className="settings-field-label">手动更新</span>
              <span className="settings-field-desc">
                {updateChannel === 'test'
                  ? '在 GitHub Releases 查看测试预览版本与更新说明'
                  : '在 GitHub Releases 查看最新正式版本与更新说明'}
              </span>
            </div>
            <Button
              className="settings-btn"
              onClick={() => {
                void openExternal(releasePage(updateChannel)).catch(() => toast.error('无法打开版本页面'))
              }}
            >
              <ExternalLink size={13} />
              版本页面
            </Button>
          </div>
        )}

        {result?.notes && (
          <div className="settings-field">
            <div className="settings-field-info">
              <span className="settings-field-label">更新说明</span>
              <span className="settings-field-desc about-release-notes">{result.notes}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
