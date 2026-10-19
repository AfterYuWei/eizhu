// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { windowControls, settings } = vi.hoisted(() => ({
  windowControls: { desktop: false, mac: false, showControls: false, maximized: false, minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
  settings: { sidebarWidth: 240, setSidebarWidth: vi.fn(), theme: 'light', systemRevision: 0 },
}))

vi.mock('@/components/Sidebar', () => ({ Sidebar: ({ visible }: { visible: boolean }) => <div data-sidebar-visible={String(visible)} /> }))
vi.mock('@/components/Terminal', () => ({ TerminalView: () => <main>终端工作区</main> }))
vi.mock('@/components/Terminal/SplitControls', () => ({ TerminalSplitMenu: () => null }))
vi.mock('@/components/Terminal/TunnelDialog', () => ({ TunnelDialog: () => null, TunnelPrompts: () => null }))
vi.mock('@/components/ProfileForm', () => ({ ProfileForm: () => null }))
vi.mock('./ServerInspector', () => ({ ServerInspector: ({ open }: { open: boolean }) => <div data-inspector-open={String(open)} /> }))
vi.mock('@/components/CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => null }))
vi.mock('@/components/SyncIndicator', () => ({ SyncIndicator: () => null }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('@/hooks/useWindowControls', () => ({ useWindowControls: () => windowControls }))
vi.mock('@/store/settings', () => ({
  useResolvedTheme: () => 'light',
  useSettingsStore: (selector?: (state: object) => unknown) => {
    return selector ? selector(settings) : settings
  },
}))

import { Layout } from './index'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useDesktopShellStore } from '@/store/desktopShell'
import { executeDesktopAction } from '@/lib/desktopActions'
import { useSessionStore } from '@/store/session'
import { useProfileStore } from '@/store/profile'
import { resetTerminalLayout, useTerminalLayoutStore } from '@/store/terminalLayout'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.assign(windowControls, { desktop: false, mac: false, showControls: false, maximized: false })
  settings.sidebarWidth = 240
  vi.clearAllMocks()
  useDesktopShellStore.setState({ serverRatio: 0.6, serversCollapsed: false, openedCollapsed: false })
  resetTerminalLayout()
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useProfileStore.setState({ fetchProfiles: async () => {}, fetchGroups: async () => {} })
  useSessionStore.setState({ tabs: [{ id: 'a', kind: 'terminal', profileId: 'p', profileName: '服务器', status: 'disconnected', sessionId: null }], activeTabId: 'a' })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  resetTerminalLayout()
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useProfileStore.setState(useProfileStore.getInitialState(), true)
})

function sidebar() { return host.querySelector<HTMLElement>('.eizhu-sidebar')! }
function toggle() { return host.querySelector<HTMLButtonElement>('.shell-top-controls button')! }
async function render() { await act(async () => root.render(<TooltipProvider><Layout /></TooltipProvider>)) }

it.each([false, true])('分屏自动收起，退出时恢复进入前状态 %s', async (collapsed) => {
  await render()
  if (collapsed) await act(async () => executeDesktopAction('sidebar'))
  expect(sidebar().classList.contains('collapsed')).toBe(collapsed)
  await act(async () => useTerminalLayoutStore.getState().split('horizontal'))
  expect(sidebar().classList.contains('collapsed')).toBe(true)
  expect(sidebar().hasAttribute('inert')).toBe(true)
  expect(toggle().disabled).toBe(false)
  await act(async () => useTerminalLayoutStore.getState().merge())
  expect(sidebar().classList.contains('collapsed')).toBe(collapsed)
})

it('分屏期间可通过按钮和快捷键展开，手动选择在退出后保留', async () => {
  await render()
  await act(async () => useTerminalLayoutStore.getState().split('vertical'))
  await act(async () => toggle().click())
  expect(sidebar().classList.contains('collapsed')).toBe(false)
  expect(sidebar().hasAttribute('inert')).toBe(false)
  await act(async () => useTerminalLayoutStore.getState().maximize())
  expect(sidebar().classList.contains('collapsed')).toBe(false)
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, shiftKey: true, bubbles: true })))
  expect(sidebar().classList.contains('collapsed')).toBe(true)
  await act(async () => useTerminalLayoutStore.getState().merge())
  expect(sidebar().classList.contains('collapsed')).toBe(true)
})

it('关闭到一个窗格时恢复侧栏且不锁定按钮', async () => {
  await render()
  await act(async () => useTerminalLayoutStore.getState().split('vertical'))
  await act(async () => useSessionStore.getState().closeTab(useSessionStore.getState().activeTabId!))
  expect(sidebar().classList.contains('collapsed')).toBe(false)
  expect(toggle().disabled).toBe(false)
})

it('恢复已有分屏布局时收起侧栏，仍能手动展开', async () => {
  useTerminalLayoutStore.getState().split('horizontal')
  await render()
  expect(sidebar().classList.contains('collapsed')).toBe(true)
  await act(async () => toggle().click())
  expect(sidebar().classList.contains('collapsed')).toBe(false)
})

it('侧栏保留图标加文字，工作区操作仅图标，详情默认关闭', async () => {
  await render()
  const nav = host.querySelector('nav[aria-label="功能导航"]')!
  expect([...nav.querySelectorAll('button')].map((b) => b.querySelector('span')?.textContent)).toEqual(['新建连接', 'SFTP 文件', '密钥管理', '命令片段'])
  const inspector = host.querySelector<HTMLButtonElement>('[aria-label="服务器详情"]')!
  expect(inspector.textContent).toBe('')
  expect(host.querySelector('[data-inspector-open="false"]')).not.toBeNull()
  await act(async () => inspector.click())
  expect(host.querySelector('[data-inspector-open="true"]')).not.toBeNull()
  expect(host.querySelector('.statusbar')).toBeNull()
})

it('关闭最后一个页面后显示连接首页', async () => {
  await render()
  await act(async () => useSessionStore.getState().closeTab('a'))
  expect(host.textContent).toContain('连接你的服务器')
  expect(host.querySelector('.shell-home input')).toBeNull()
  expect(host.querySelector('.shell-home-shortcuts')).not.toBeNull()
})

it('设置整页覆盖时保留终端节点、阻止后台快捷键，返回后恢复焦点', async () => {
  await import('@/components/SettingsDialog')
  await render()
  const terminal = host.querySelector('.shell-workspace-content > main')!
  const account = host.querySelector<HTMLButtonElement>('.shell-account')!
  account.focus()
  await act(async () => executeDesktopAction('account-settings'))
  expect(host.querySelector('.settings-page')).not.toBeNull()
  expect(host.querySelector('.shell-session-view')?.hasAttribute('inert')).toBe(true)
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(host.querySelector('.settings-page-heading')?.textContent).toBe('账号')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'W', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })))
  expect(useSessionStore.getState().tabs).toHaveLength(1)
  await act(async () => host.querySelector<HTMLButtonElement>('.settings-page-back')!.click())
  expect(host.querySelector('.settings-page')).toBeNull()
  expect(host.querySelector('.shell-workspace-content > main')).toBe(terminal)
  expect(host.querySelector('.shell-session-view')?.hasAttribute('inert')).toBe(false)
  expect(document.activeElement).toBe(account)
})

it('macOS 为原生红绿灯保留最小宽度，折叠后工具图标移动到工作区', async () => {
  Object.assign(windowControls, { desktop: true, mac: true })
  settings.sidebarWidth = 160
  await render()
  expect(sidebar().style.width).toBe('180px')
  expect(host.querySelector('[aria-label="调整侧栏宽度"]')?.getAttribute('aria-valuemin')).toBe('180')
  expect(host.querySelector('.titlebar-controls')).toBeNull()
  expect(host.querySelector('.shell-sidebar-top .shell-top-controls')).not.toBeNull()
  await act(async () => toggle().click())
  expect(host.querySelector('.shell-sidebar-top .shell-top-controls')).toBeNull()
  expect(host.querySelector('.shell-workspace-header .shell-top-controls')).not.toBeNull()
  expect(host.querySelector('.desktop-shell.is-mac.sidebar-is-hidden')).not.toBeNull()
})

it('Windows 窗口控制位于窗口层而非圆角工作区，按钮独立响应', async () => {
  Object.assign(windowControls, { desktop: true, showControls: true })
  await render()
  const controls = host.querySelector<HTMLElement>('.shell-window-controls')!
  expect(controls.parentElement).toBe(host.querySelector('.desktop-shell'))
  expect(controls.closest('.shell-workspace')).toBeNull()
  expect(host.querySelector('.shell-window-controls-space')).not.toBeNull()
  const buttons = [...controls.querySelectorAll('button')]
  expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['最小化', '最大化', '关闭'])
  for (const button of buttons) {
    expect(button.hasAttribute('data-tauri-drag-region')).toBe(false)
    await act(async () => button.click())
  }
  expect(windowControls.minimize).toHaveBeenCalledOnce()
  expect(windowControls.toggleMaximize).toHaveBeenCalledOnce()
  expect(windowControls.close).toHaveBeenCalledOnce()
  windowControls.maximized = true
  await render()
  expect(controls.querySelector('[aria-label="还原"]')).not.toBeNull()
  await act(async () => toggle().click())
  expect(host.querySelector('.shell-window-controls')).toBe(controls)
})
