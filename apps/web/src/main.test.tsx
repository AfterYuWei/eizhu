// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

const startup = vi.hoisted(() => ({
  workspace: { id: 'offline', generation: 1, userId: 0 },
  applyWorkspace: vi.fn(),
  createRoot: vi.fn(),
  render: vi.fn(),
}))

vi.mock('react-dom/client', () => ({ createRoot: startup.createRoot }))
vi.mock('@/lib/bridge', () => ({
  bridge: vi.fn(),
  desktopBootstrap: () => ({ window: 'main', workspace: startup.workspace }),
}))
vi.mock('@/lib/platform', () => ({ initializePlatform: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/settingsStorage', () => ({ initializeSettingsStorage: vi.fn() }))
vi.mock('@/lib/appLog', () => ({ installFrontendLogging: vi.fn() }))
vi.mock('@/lib/workspace', () => ({ applyWorkspace: startup.applyWorkspace }))
vi.mock('@/components/MainWindowReady', () => ({ MainWindowReady: () => null }))
vi.mock('./App', () => ({ default: () => null }))

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

it('主窗口应用启动空间后才挂载连接控件并报告界面就绪', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  startup.createRoot.mockReturnValue({ render: startup.render })
  vi.spyOn(window, 'addEventListener').mockImplementation(() => {})

  await import('./main')
  await vi.waitFor(() => expect(startup.render).toHaveBeenCalledOnce())

  expect(startup.applyWorkspace).toHaveBeenCalledExactlyOnceWith(startup.workspace)
  expect(startup.applyWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
    startup.createRoot.mock.invocationCallOrder[0],
  )
})
