// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { UpdateDownloadProgress } from '@/lib/updater'

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  install: vi.fn(),
  open: vi.fn(),
  updatesAvailable: true,
  channel: 'test' as 'stable' | 'test',
}))
vi.mock('@/lib/updater', async (original) => ({
  ...(await original<typeof import('@/lib/updater')>()),
  appVersion: async () => '0.5.0-test.100.abcdef12',
  checkForUpdates: mocks.check,
  downloadAndInstallUpdate: mocks.install,
}))
vi.mock('@/lib/platform', () => ({
  isDesktopRuntime: () => true,
  getPlatformCapabilities: () => ({ appUpdates: mocks.updatesAvailable }),
}))
vi.mock('@/lib/desktop', () => ({ openExternal: mocks.open }))
vi.mock('@/store/settings', () => ({
  useSettingsStore: (select: (state: unknown) => unknown) =>
    select({
      updateChannel: mocks.channel,
      setUpdateChannel: vi.fn(),
    }),
}))
vi.mock('sonner', () => ({ toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() } }))
import { AboutPanel } from './AboutPanel'

let host: HTMLDivElement, root: Root
const current = { available: false, version: '0.5.0', newVersion: '', notes: '' }
function button(label: string) {
  return [...host.querySelectorAll('button')].find((element) => element.textContent === label)!
}
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mocks.updatesAvailable = true
  mocks.channel = 'test'
  mocks.check.mockResolvedValue(current)
  mocks.open.mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
it.each(['test', 'stable'] as const)(
  '%s 通道检查后持续显示最新状态，版本页面对应选择的通道',
  async (channel) => {
    mocks.channel = channel
    await act(async () => root.render(<AboutPanel />))
    await act(async () => button('检查更新').click())
    expect(mocks.check).toHaveBeenCalledWith(channel)
    expect(host.textContent).toContain(`当前已是${channel === 'test' ? '测试版' : '正式版'}通道的最新版本`)
    await act(async () => button('版本页面').click())
    expect(mocks.open).toHaveBeenCalledWith(
      `https://github.com/AfterYuWei/eizhu/releases${channel === 'stable' ? '/latest' : ''}`,
    )
  },
)
it('检查失败保留页面反馈并允许重试，不显示已是最新', async () => {
  mocks.check.mockRejectedValueOnce(new Error('网络连接失败，请手动安装'))
  await act(async () => root.render(<AboutPanel />))
  await act(async () => button('检查更新').click())
  expect(host.textContent).toContain('网络连接失败，请手动安装')
  expect(host.textContent).not.toContain('通道的最新版本')
  await act(async () => button('检查更新').click())
  expect(host.textContent).toContain('当前已是测试版通道的最新版本')
})
it('开发模式及不支持在线更新的安装方式提供手动下载', async () => {
  mocks.updatesAvailable = false
  await act(async () => root.render(<AboutPanel />))
  expect(button('检查更新').disabled).toBe(true)
  expect(host.textContent).toContain('手动安装')
  await act(async () => button('版本页面').click())
  expect(mocks.check).not.toHaveBeenCalled()
  expect(mocks.open).toHaveBeenCalledOnce()
})
it('安装阶段显示重启提示，下载失败后重新检查候选', async () => {
  mocks.check.mockResolvedValue({
    ...current,
    available: true,
    newVersion: '0.5.1-test.101.abcdef12',
    notes: '修复更新',
  })
  let fail!: (error: Error) => void
  mocks.install.mockImplementation(
    async (_channel: string, progress: (value: UpdateDownloadProgress) => void) => {
      progress({
        phase: 'installing',
        percent: null,
        downloadedBytes: 0,
        totalBytes: null,
        bytesPerSecond: 0,
      })
      await new Promise<void>((_resolve, reject) => {
        fail = reject
      })
    },
  )
  await act(async () => root.render(<AboutPanel />))
  await act(async () => button('检查更新').click())
  expect(host.textContent).toContain('修复更新')
  await act(async () => button('下载并安装').click())
  expect(host.textContent).toContain('正在安装更新，应用即将重启')
  await act(async () => fail(new Error('校验失败')))
  expect(button('检查更新').disabled).toBe(false)
  expect(button('下载并安装')).toBeUndefined()
})
