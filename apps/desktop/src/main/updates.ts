import { randomUUID } from 'node:crypto'
import type { AppUpdater, UpdateInfo } from 'electron-updater'
import { fail } from '@eizhu/contracts'
import type { UpdateCandidate, UpdateChannel, UpdateProgress } from '@eizhu/contracts'

type Driver = Pick<
  AppUpdater,
  | 'checkForUpdates'
  | 'downloadUpdate'
  | 'quitAndInstall'
  | 'setFeedURL'
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'allowDowngrade'
  | 'allowPrerelease'
  | 'disableDifferentialDownload'
  | 'logger'
  | 'on'
>

/** Main owns one displayed candidate. No second check may replace it during download/install. */
export class Updates {
  private candidate?: UpdateCandidate
  private downloaded = false
  private installError = false
  private installDisabled = false
  busy = false
  constructor(privateOptions: {
    driver: Driver
    feeds: Partial<Record<UpdateChannel, string>>
    supported: boolean
    progress: (progress: UpdateProgress) => void
    install: (action: () => void) => Promise<boolean>
  }) {
    this.options = privateOptions
    const driver = privateOptions.driver
    driver.autoDownload = false
    driver.autoInstallOnAppQuit = false
    driver.allowDowngrade = false
    driver.disableDifferentialDownload = true
    driver.logger = null
    // Always consume library errors; raw server messages/paths never enter diagnostics or UI.
    driver.on('error', () => {
      this.installError = true
    })
    driver.on('download-progress', (info) => {
      if (!this.busy || !this.candidate) return
      const finite = (value: number) => (Number.isFinite(value) && value >= 0 ? value : 0)
      this.options.progress({
        token: this.candidate.token,
        phase: 'downloading',
        downloadedBytes: finite(info.transferred),
        totalBytes: info.total > 0 ? finite(info.total) || null : null,
        percent: Number.isFinite(info.percent) ? Math.max(0, Math.min(100, info.percent)) : null,
        bytesPerSecond: finite(info.bytesPerSecond),
      })
    })
  }
  private options: {
    driver: Driver
    feeds: Partial<Record<UpdateChannel, string>>
    supported: boolean
    progress: (progress: UpdateProgress) => void
    install: (action: () => void) => Promise<boolean>
  }
  get available(): boolean {
    return this.options.supported && Object.keys(this.options.feeds).length > 0
  }
  invalidate(): void {
    if (this.busy) fail('UPDATE_BUSY', '请等待更新操作完成')
    this.candidate = undefined
    this.downloaded = false
  }
  private require(token: string): UpdateCandidate {
    if (!this.candidate || this.candidate.token !== token)
      fail('UPDATE_EXPIRED', '更新候选已失效，请重新检查')
    return this.candidate
  }
  async check(channel: UpdateChannel): Promise<{ candidate: UpdateCandidate | null }> {
    this.invalidate()
    if (!this.options.supported) fail('UPDATE_UNSUPPORTED', '当前运行方式不支持应用内更新，请手动安装新版本')
    const url = this.options.feeds[channel]
    if (!url) fail('UPDATE_NOT_CONFIGURED', '此通道尚未配置独立 Electron 更新源，请手动安装')
    this.busy = true
    try {
      this.options.driver.allowPrerelease = channel === 'test'
      this.options.driver.setFeedURL({
        provider: 'generic',
        url,
        channel: 'latest',
        useMultipleRangeRequest: false,
      })
      const result = await this.options.driver.checkForUpdates()
      if (!result) fail('UPDATE_UNAVAILABLE', '当前安装无法检查更新，请手动安装')
      if (!result.isUpdateAvailable) return { candidate: null }
      validateUpdateInfo(result.updateInfo, channel)
      const notes = result.updateInfo.releaseNotes
      this.candidate = {
        token: randomUUID(),
        channel,
        version: result.updateInfo.version,
        notes: (typeof notes === 'string' ? notes : (notes?.map((note) => note.note).join('\n') ?? '')).slice(
          0,
          32768,
        ),
      }
      return { candidate: { ...this.candidate } }
    } catch {
      fail('UPDATE_CHECK_FAILED', '检查更新失败，请检查更新源和网络后重试')
    } finally {
      this.busy = false
    }
  }
  async download(token: string): Promise<void> {
    if (this.busy) fail('UPDATE_BUSY', '请等待更新操作完成')
    this.require(token)
    if (this.downloaded) return
    this.busy = true
    try {
      // electron-updater retains the exact UpdateInfo/provider returned by checkForUpdates.
      const paths = await this.options.driver.downloadUpdate()
      if (!paths.length) fail('UPDATE_DOWNLOAD_FAILED', '下载未产生可安装的更新')
      this.downloaded = true
    } catch {
      this.candidate = undefined
      fail('UPDATE_DOWNLOAD_FAILED', '下载或校验失败，请重新检查更新')
    } finally {
      this.busy = false
    }
  }
  async install(token: string): Promise<void> {
    if (this.busy) fail('UPDATE_BUSY', '请等待更新操作完成')
    if (this.installDisabled) fail('UPDATE_INSTALL_FAILED', '请保留编辑内容并重启应用，或手动安装新版本')
    this.require(token)
    if (!this.downloaded) fail('UPDATE_NOT_DOWNLOADED', '请先下载并校验更新')
    this.busy = true
    try {
      const accepted = await this.options.install(() => {
        this.options.progress({
          token,
          phase: 'installing',
          downloadedBytes: 0,
          totalBytes: null,
          percent: null,
          bytesPerSecond: 0,
        })
        this.installError = false
        this.options.driver.quitAndInstall(false, true)
        if (this.installError) {
          this.installDisabled = true
          fail('UPDATE_INSTALL_FAILED', '无法启动更新安装，窗口已保留，请重启应用或手动安装新版本')
        }
      })
      if (!accepted) fail('UPDATE_CANCELLED', '已取消安装，更新保留在缓存中')
    } finally {
      this.busy = false
    }
  }
}

export function validateUpdateInfo(info: UpdateInfo, channel: UpdateChannel): void {
  if (
    !/^\d+\.\d+\.\d+(?:-test\.\d+\.[0-9a-f]+)?$/.test(info.version) ||
    (channel === 'stable' && info.version.includes('-'))
  )
    fail('UPDATE_INVALID', '更新版本无效')
  if (!info.files?.length || info.files.length > 8) fail('UPDATE_INVALID', '更新文件无效')
  for (const file of info.files) {
    // Only immutable filenames within the configured channel/target directory are accepted.
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(file.url) ||
      file.url.includes('..') ||
      !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) ||
      (file.size !== undefined &&
        (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 4 * 1024 ** 3))
    )
      fail('UPDATE_INVALID', '更新摘要或文件路径无效')
  }
  if ('packages' in info && info.packages) fail('UPDATE_INVALID', '不支持网络安装器更新')
}
