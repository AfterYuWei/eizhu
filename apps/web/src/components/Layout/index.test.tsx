// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { windowControls, settings } = vi.hoisted(() => ({
  windowControls: { desktop: false, mac: false, showControls: false, maximized: false, minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
  settings: { sidebarWidth: 300, setSidebarWidth: vi.fn(), theme: 'light', terminalTheme: 'default', systemRevision: 0 },
}))

vi.mock('@/components/Sidebar', () => ({ Sidebar: ({ visible }: { visible: boolean }) => <div data-sidebar-visible={String(visible)} /> }))
vi.mock('@/components/Vault/VaultView', () => ({ VaultView: () => <input aria-label="密钥管理状态" /> }))
vi.mock('@/components/Terminal', () => ({ TerminalView: () => <main>终端工作区</main> }))
vi.mock('@/components/Terminal/SplitControls', () => ({ TerminalSplitMenu: () => null }))
vi.mock('@/components/Terminal/TunnelDialog', () => ({ TunnelDialog: () => null, TunnelPrompts: () => null }))
vi.mock('@/components/ProfileForm', () => ({ ProfileForm: () => null }))
vi.mock('./ServerInspector', () => ({ ServerInspector: ({ open }: { open: boolean }) => <div data-inspector-open={String(open)} /> }))
vi.mock('@/components/CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('@/components/Snippets/SnippetDialog', () => ({ SnippetDialog: () => <div role="dialog" aria-label="片段管理" /> }))
vi.mock('@/components/Snippets/SnippetQuickPicker', () => ({ SnippetQuickPicker: ({ target, onManage }: { target: { tabId: string } | null; onManage: () => void }) => <div role="dialog" className="snippet-quick-picker" aria-label="快速调用片段" data-target={target?.tabId}><button onClick={onManage}>管理片段</button></div> }))
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
import { resetWorkspaceView, useWorkspaceViewStore } from '@/store/workspaceView'
import { useSessionStore } from '@/store/session'
import { useProfileStore } from '@/store/profile'
import { resetTerminalLayout, useTerminalLayoutStore } from '@/store/terminalLayout'
import { SIDEBAR_COLLAPSE_DELAY_MS, SIDEBAR_PREVIEW_ANIMATION_MS, SIDEBAR_PREVIEW_CLOSE_DELAY_MS } from '@/lib/desktopSidebar'

let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  await resetWorkspaceView()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.assign(windowControls, { desktop: false, mac: false, showControls: false, maximized: false })
  settings.sidebarWidth = 300
  vi.clearAllMocks()
  settings.setSidebarWidth.mockImplementation((width: number) => { settings.sidebarWidth = width })
  useDesktopShellStore.setState({ serversCollapsed: false, settingsPage: null })
  resetTerminalLayout()
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useProfileStore.setState({ fetchProfiles: async () => {}, fetchGroups: async () => {} })
  useSessionStore.setState({ tabs: [{ id: 'a', profileId: 'p', profileName: '服务器', status: 'disconnected', sessionId: null }], activeTabId: 'a' })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  vi.useRealTimers()
  host.remove()
  vi.unstubAllGlobals()
  resetTerminalLayout()
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useProfileStore.setState(useProfileStore.getInitialState(), true)
})

function sidebar() { return host.querySelector<HTMLElement>('.eizhu-sidebar')! }
function toggle() { return host.querySelector<HTMLButtonElement>('.shell-top-controls button')! }
async function render() { await act(async () => root.render(<TooltipProvider><Layout /></TooltipProvider>)) }

it('侧栏打开片段管理，快捷键打开独立快选器并固定调用时的终端', async () => {
  await render()
  await act(async () => host.querySelectorAll<HTMLButtonElement>('.shell-primary-nav > button')[3].click())
  expect(document.querySelector('[aria-label="片段管理"]')).not.toBeNull()
  expect(document.querySelector('[aria-label="快速调用片段"]')).toBeNull()
  await act(async () => root.render(null))
  useSessionStore.getState().updateTabStatus('a', 'connected', 'session-a')
  await render()
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })))
  expect(document.querySelector('[aria-label="快速调用片段"]')?.getAttribute('data-target')).toBe('a')
  await act(async () => useSessionStore.getState().openDraftTab())
  expect(document.querySelector('[aria-label="快速调用片段"]')?.getAttribute('data-target')).toBe('a')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="快速调用片段"] button')!.click())
  expect(document.querySelector('[aria-label="快速调用片段"]')).toBeNull()
  expect(document.querySelector('[aria-label="片段管理"]')).not.toBeNull()
})

async function pointer(handle: HTMLElement, type: string, clientX: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { button: 0, pointerId: 1, clientX })
  await act(async () => handle.dispatchEvent(event))
}

async function hover(target: HTMLElement, type = 'pointerover', relatedTarget: EventTarget | null = document.body, props: Record<string, unknown> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { button: -1, buttons: 0, pointerId: 2, pointerType: 'mouse', clientX: 600, clientY: 300, relatedTarget, ...props })
  await act(async () => target.dispatchEvent(event))
}

it('自动收起恢复焦点时不显示提示，焦点、触摸和按住鼠标经过不会临时展开', async () => {
  vi.useFakeTimers()
  await render()
  await act(async () => executeDesktopAction('sidebar'))
  toggle().focus()
  await act(async () => vi.advanceTimersByTime(500))
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  expect(sidebar().classList.contains('is-preview')).toBe(false)
  await hover(toggle(), 'pointerover', document.body, { pointerType: 'touch' })
  expect(sidebar().classList.contains('is-preview')).toBe(false)
  await hover(toggle(), 'pointerover', document.body, { buttons: 1 })
  expect(sidebar().classList.contains('is-preview')).toBe(false)
})

it('悬停临时展开可操作导航，离开后淡出且保留原宽度和收起偏好', async () => {
  vi.useFakeTimers()
  settings.sidebarWidth = 420
  await render()
  const terminal = host.querySelector('.shell-workspace-content main')!
  await act(async () => executeDesktopAction('sidebar'))
  await hover(toggle())
  // Entering the newly appeared sidebar must not cancel its entrance frame.
  await hover(sidebar())
  await act(async () => vi.advanceTimersByTime(40))
  expect(sidebar().classList.contains('is-preview-open')).toBe(true)
  expect(sidebar().style.width).toBe('300px')
  expect(sidebar().hasAttribute('inert')).toBe(false)
  expect(host.querySelector('.desktop-shell.sidebar-is-hidden')).not.toBeNull()
  expect(host.querySelector('.shell-top-controls-slot button')).toBeNull()
  expect(host.querySelector('.shell-fixed-top-controls')?.closest('[inert]')).toBeNull()
  expect(host.querySelector('.shell-workspace-content main')).toBe(terminal)
  await act(async () => host.querySelectorAll<HTMLButtonElement>('.shell-primary-nav > button')[2].click())
  expect(useWorkspaceViewStore.getState().activePage).toBe('vault')
  expect(useSessionStore.getState().tabs).toHaveLength(1)
  host.querySelectorAll<HTMLButtonElement>('.shell-primary-nav > button')[2].focus()
  await hover(sidebar(), 'pointerout')
  await act(async () => vi.advanceTimersByTime(SIDEBAR_PREVIEW_CLOSE_DELAY_MS))
  expect(sidebar().classList.contains('is-preview')).toBe(true)
  expect(sidebar().classList.contains('is-preview-open')).toBe(false)
  expect(sidebar().hasAttribute('inert')).toBe(true)
  await act(async () => vi.advanceTimersByTime(SIDEBAR_PREVIEW_ANIMATION_MS + 20))
  expect(sidebar().classList.contains('is-preview')).toBe(false)
  expect(sidebar().classList.contains('is-preview-resting')).toBe(true)
  expect(sidebar().style.width).toBe('420px')
  expect(host.querySelector<HTMLElement>('.shell-sidebar-space')?.style.width).toBe('0px')
  expect(settings.setSidebarWidth).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(toggle())
})

it('淡出途中移回可以反向淡入，点击展开固定侧栏', async () => {
  vi.useFakeTimers()
  await render()
  await act(async () => executeDesktopAction('sidebar'))
  await hover(toggle())
  await act(async () => vi.advanceTimersByTime(40))
  await hover(sidebar(), 'pointerout')
  await act(async () => vi.advanceTimersByTime(SIDEBAR_PREVIEW_CLOSE_DELAY_MS))
  await hover(sidebar())
  expect(sidebar().classList.contains('is-preview-open')).toBe(true)
  await act(async () => vi.advanceTimersByTime(SIDEBAR_PREVIEW_ANIMATION_MS))
  expect(sidebar().classList.contains('is-preview-open')).toBe(true)
  await act(async () => toggle().click())
  expect(sidebar().classList.contains('is-preview')).toBe(false)
  expect(host.querySelector('.desktop-shell.sidebar-is-hidden')).toBeNull()
  expect(host.querySelector<HTMLElement>('.shell-sidebar-space.is-button-motion')?.style.width).toBe('300px')
  await hover(sidebar(), 'pointerout')
  await act(async () => vi.advanceTimersByTime(500))
  expect(sidebar().classList.contains('collapsed')).toBe(false)
})

it('侧栏移到静止鼠标下方时保持预览，鼠标真正移开后才隐藏', async () => {
  vi.useFakeTimers()
  await render()
  await act(async () => executeDesktopAction('sidebar'))
  vi.spyOn(sidebar(), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 300, bottom: 900, width: 300, height: 900, x: 0, y: 0, toJSON() {} })
  const trigger = toggle()
  await hover(trigger, 'pointerover', document.body, { clientX: 40, clientY: 32 })
  await hover(trigger, 'pointerout', document.body, { clientX: 40, clientY: 32 })
  await act(async () => vi.advanceTimersByTime(500))
  expect(sidebar().classList.contains('is-preview-open')).toBe(true)
  await hover(document.body, 'pointermove')
  await act(async () => vi.advanceTimersByTime(SIDEBAR_PREVIEW_CLOSE_DELAY_MS + SIDEBAR_PREVIEW_ANIMATION_MS))
  expect(sidebar().classList.contains('is-preview')).toBe(false)
})

it.each([false, true])('悬停淡入淡出期间展开和搜索按钮保持同一节点且可操作，macOS=%s', async (mac) => {
  vi.useFakeTimers()
  Object.assign(windowControls, { desktop: true, mac })
  await render()
  await act(async () => executeDesktopAction('sidebar'))
  const controls = host.querySelector<HTMLElement>('.shell-fixed-top-controls')!
  const buttons = [...controls.querySelectorAll<HTMLButtonElement>('button')]
  const icons = buttons.map((button) => button.querySelector('svg'))
  const assertStable = () => {
    expect(host.querySelector('.shell-fixed-top-controls')).toBe(controls)
    expect([...controls.querySelectorAll('button')]).toEqual(buttons)
    expect(buttons.map((button) => button.querySelector('svg'))).toEqual(icons)
    expect(host.querySelectorAll('.shell-top-controls')).toHaveLength(1)
    expect(controls.closest('.shell-sidebar, .shell-workspace, [inert]')).toBeNull()
    expect(controls.style.visibility).toBe('')
    expect(buttons.every((button) => !button.disabled)).toBe(true)
  }
  await hover(buttons[0])
  assertStable()
  await act(async () => vi.advanceTimersByTime(40))
  expect(sidebar().classList.contains('is-preview-open')).toBe(true)
  assertStable()
  await hover(sidebar(), 'pointerout')
  await act(async () => vi.advanceTimersByTime(SIDEBAR_PREVIEW_CLOSE_DELAY_MS))
  expect(sidebar().classList.contains('is-preview-open')).toBe(false)
  assertStable()
  await act(async () => vi.advanceTimersByTime(SIDEBAR_PREVIEW_ANIMATION_MS))
  assertStable()
  await act(async () => buttons[0].click())
  expect(sidebar().classList.contains('collapsed')).toBe(false)
})

it('移入侧栏弹出菜单保持预览，菜单关闭且鼠标已离开时再收起', async () => {
  vi.useFakeTimers()
  await render()
  await act(async () => executeDesktopAction('sidebar'))
  await hover(toggle())
  await act(async () => vi.advanceTimersByTime(40))
  const menu = document.createElement('div')
  menu.setAttribute('data-sidebar-popover', '')
  menu.setAttribute('data-state', 'open')
  await act(async () => document.body.append(menu))
  await hover(sidebar(), 'pointerout', menu)
  await hover(menu, 'pointermove')
  await act(async () => vi.advanceTimersByTime(500))
  expect(sidebar().classList.contains('is-preview-open')).toBe(true)
  // The last target is removed while the physical cursor remains outside.
  await act(async () => menu.remove())
  await act(async () => vi.advanceTimersByTime(SIDEBAR_PREVIEW_CLOSE_DELAY_MS + SIDEBAR_PREVIEW_ANIMATION_MS))
  expect(sidebar().classList.contains('is-preview')).toBe(false)
})

it('阈值停顿后收起，向右拉回默认宽度并等鼠标追上边缘再调整，终端保持挂载', async () => {
  vi.useFakeTimers()
  await render()
  const terminal = host.querySelector('.shell-workspace-content main')!
  const handle = host.querySelector<HTMLElement>('[aria-label="调整侧栏宽度"]')!
  handle.setPointerCapture = vi.fn()
  handle.hasPointerCapture = vi.fn(() => true)
  handle.releasePointerCapture = vi.fn()
  await pointer(handle, 'pointerdown', 304)
  await pointer(handle, 'pointermove', 424)
  await render()
  expect(sidebar().style.width).toBe('420px')
  await pointer(handle, 'pointermove', 304)
  await render()
  expect(sidebar().style.width).toBe('300px')
  expect(sidebar().classList.contains('collapsed')).toBe(false)
  await pointer(handle, 'pointermove', 303)
  await render()
  expect(sidebar().style.width).toBe('299px')
  expect(sidebar().classList.contains('collapsed')).toBe(false)
  await pointer(handle, 'pointermove', 254)
  await render()
  expect(sidebar().style.width).toBe('250px')
  expect(sidebar().classList.contains('collapsed')).toBe(false)
  await pointer(handle, 'pointermove', 253)
  await act(async () => vi.advanceTimersByTime(SIDEBAR_COLLAPSE_DELAY_MS - 1))
  expect(sidebar().classList.contains('collapsed')).toBe(false)
  await act(async () => vi.advanceTimersByTime(1))
  expect(sidebar().classList.contains('collapsed')).toBe(true)
  expect(sidebar().style.width).toBe('250px')
  expect(host.querySelector<HTMLElement>('.shell-sidebar-space')?.style.width).toBe('0px')
  expect(host.querySelector('.shell-sidebar-resizer')).toBe(handle)
  expect(handle.getAttribute('aria-hidden')).toBe('true')
  expect(handle.releasePointerCapture).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(toggle())
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  await pointer(handle, 'pointermove', 261)
  expect(sidebar().style.width).toBe('300px')
  expect(host.querySelector<HTMLElement>('.shell-sidebar-space')?.style.width).toBe('300px')
  expect(host.querySelector('.shell-sidebar-space.is-button-motion')).toBeNull()
  expect(sidebar().classList.contains('collapsed')).toBe(false)
  await pointer(handle, 'pointermove', 277)
  await render()
  expect(sidebar().style.width).toBe('300px')
  await pointer(handle, 'pointermove', 304)
  await render()
  expect(sidebar().style.width).toBe('300px')
  await pointer(handle, 'pointermove', 320)
  await render()
  expect(sidebar().style.width).toBe('316px')
  await pointer(handle, 'pointerup', 320)
  await act(async () => toggle().click())
  await act(async () => toggle().click())
  expect(sidebar().style.width).toBe('300px')
  expect(sidebar().classList.contains('collapsed')).toBe(false)
  expect(host.querySelector('.shell-workspace-content main')).toBe(terminal)
})

it('手动展开重置旧宽度，分屏自动恢复保留较宽侧栏', async () => {
  settings.sidebarWidth = 420
  await render()
  await act(async () => useTerminalLayoutStore.getState().split('horizontal'))
  await act(async () => useTerminalLayoutStore.getState().merge())
  expect(sidebar().style.width).toBe('420px')
  expect(settings.setSidebarWidth).not.toHaveBeenCalled()
  await act(async () => executeDesktopAction('sidebar'))
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, shiftKey: true, bubbles: true })))
  expect(sidebar().style.width).toBe('300px')
})

it('点击展开和收起均推动占位，拖拽能从动画当前宽度接手且终端不重建', async () => {
  settings.sidebarWidth = 420
  await render()
  const terminal = host.querySelector('.shell-workspace-content main')!
  const space = host.querySelector<HTMLElement>('.shell-sidebar-space')!
  await act(async () => toggle().click())
  expect(space.classList.contains('is-button-motion')).toBe(true)
  expect(space.style.width).toBe('0px')
  await act(async () => toggle().click())
  expect(space.classList.contains('is-button-motion')).toBe(true)
  expect(space.style.width).toBe('300px')
  vi.spyOn(space, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 280, bottom: 900, width: 280, height: 900, x: 0, y: 0, toJSON() {} })
  const handle = host.querySelector<HTMLElement>('.shell-sidebar-resizer')!
  handle.setPointerCapture = vi.fn()
  handle.hasPointerCapture = vi.fn(() => true)
  handle.releasePointerCapture = vi.fn()
  await pointer(handle, 'pointerdown', 284)
  await render()
  expect(space.classList.contains('is-button-motion')).toBe(false)
  expect(space.style.width).toBe('280px')
  await pointer(handle, 'pointermove', 300)
  await render()
  expect(space.style.width).toBe('296px')
  expect(host.querySelector('.shell-workspace-content main')).toBe(terminal)
  await pointer(handle, 'pointerup', 300)
})

it('点击收起后不因按钮留在鼠标下方立刻悬浮展开，移开再进入才预览', async () => {
  vi.useFakeTimers()
  await render()
  await act(async () => toggle().click())
  await hover(toggle())
  await act(async () => vi.advanceTimersByTime(500))
  expect(sidebar().classList.contains('is-preview')).toBe(false)
  await hover(toggle(), 'pointerout')
  await hover(toggle())
  await act(async () => vi.advanceTimersByTime(40))
  expect(sidebar().classList.contains('is-preview-open')).toBe(true)
})

it('分屏期间通过键盘拖窄收起，退出后保持收起，快捷键展开恢复默认宽度', async () => {
  await render()
  await act(async () => useTerminalLayoutStore.getState().split('horizontal'))
  await act(async () => toggle().click())
  const handle = host.querySelector<HTMLElement>('[aria-label="调整侧栏宽度"]')!
  handle.focus()
  await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })))
  await render()
  expect(sidebar().style.width).toBe('250px')
  expect(sidebar().classList.contains('collapsed')).toBe(false)
  await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })))
  expect(sidebar().classList.contains('collapsed')).toBe(true)
  await act(async () => useTerminalLayoutStore.getState().merge())
  expect(sidebar().classList.contains('collapsed')).toBe(true)
  await act(async () => executeDesktopAction('sidebar'))
  expect(sidebar().style.width).toBe('300px')
})

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
  const terminal = host.querySelector('.shell-workspace-content main')!
  const account = host.querySelector<HTMLButtonElement>('.shell-account')!
  account.focus()
  await act(async () => executeDesktopAction('sync-settings'))
  expect(host.querySelector('.settings-page')).not.toBeNull()
  expect(host.querySelector('.shell-session-view')?.hasAttribute('inert')).toBe(true)
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(host.querySelector('.settings-page-heading')?.textContent).toBe('云同步')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'W', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })))
  expect(useSessionStore.getState().tabs).toHaveLength(1)
  await act(async () => host.querySelector<HTMLButtonElement>('.settings-page-back')!.click())
  expect(host.querySelector('.settings-page')).toBeNull()
  expect(host.querySelector('.shell-workspace-content main')).toBe(terminal)
  expect(host.querySelector('.shell-session-view')?.hasAttribute('inert')).toBe(false)
  expect(document.activeElement).toBe(account)
})

it('旧窄侧栏按最小展开宽度显示，macOS 折叠后工具图标移动到工作区', async () => {
  Object.assign(windowControls, { desktop: true, mac: true })
  settings.sidebarWidth = 160
  await render()
  expect(sidebar().style.width).toBe('250px')
  expect(host.querySelector('[aria-label="调整侧栏宽度"]')?.getAttribute('aria-valuemin')).toBe('250')
  expect(host.querySelector('.titlebar-controls')).toBeNull()
  expect(host.querySelector('.shell-sidebar-top .shell-top-controls')).not.toBeNull()
  await act(async () => toggle().click())
  expect(host.querySelector('.shell-sidebar-top .shell-top-controls')).toBeNull()
  expect(host.querySelector('.shell-fixed-top-controls .shell-top-controls')).not.toBeNull()
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
    expect(button.hasAttribute('data-eizhu-drag-region')).toBe(false)
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

it('账号空间更换重挂载后保留设置分类', async () => {
  await import('@/components/SettingsDialog')
  await render()
  await act(async () => executeDesktopAction('sync-settings'))
  expect(host.querySelector('.settings-page-heading')?.textContent).toBe('云同步')
  await act(async () => root.render(<TooltipProvider><Layout key="next-workspace" /></TooltipProvider>))
  expect(host.querySelector('.settings-page-heading')?.textContent).toBe('云同步')
})
