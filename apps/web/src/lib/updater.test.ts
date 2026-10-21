import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  on: vi.fn(),
  stop: vi.fn(),
}))
vi.mock('./bridge', () => ({
  bridge: () => ({ update: mocks, events: { on: mocks.on } }),
  desktopBootstrap: () => ({ version: '0.4.4' }),
}))
const candidate = { token: 'a1', channel: 'test', version: '0.5.0-test.1.abc', notes: '修复' }
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  mocks.check.mockResolvedValue({ candidate })
  mocks.download.mockResolvedValue(undefined)
  mocks.install.mockResolvedValue(undefined)
  mocks.on.mockReturnValue(mocks.stop)
})
it('安装使用用户看到的候选，不在下载前重查；通道不符时拒绝安装', async () => {
  const api = await import('./updater')
  expect((await api.checkForUpdates('test')).newVersion).toBe(candidate.version)
  await expect(api.downloadAndInstallUpdate('stable')).rejects.toThrow('候选已失效')
  await api.downloadAndInstallUpdate('test')
  expect(mocks.check).toHaveBeenCalledTimes(1)
  expect(mocks.download).toHaveBeenCalledWith({ token: candidate.token })
  expect(mocks.install).toHaveBeenCalledWith({ token: candidate.token })
  expect(mocks.stop).toHaveBeenCalledOnce()
})
it('校验失败不会发起安装，并释放进度订阅', async () => {
  const api = await import('./updater')
  await api.checkForUpdates('test')
  mocks.download.mockRejectedValue(new Error('校验失败'))
  await expect(api.downloadAndInstallUpdate('test')).rejects.toThrow('校验失败')
  expect(mocks.install).not.toHaveBeenCalled()
  expect(mocks.stop).toHaveBeenCalledOnce()
})
it('重新检查失败时丢弃旧展示候选', async () => {
  const api = await import('./updater')
  await api.checkForUpdates('test')
  mocks.check.mockRejectedValue(new Error('更新源未配置'))
  await expect(api.checkForUpdates('test')).rejects.toThrow('更新源未配置')
  await expect(api.downloadAndInstallUpdate('test')).rejects.toThrow('候选已失效')
})
