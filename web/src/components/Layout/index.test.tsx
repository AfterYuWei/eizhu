// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/components/Sidebar', () => ({ Sidebar: ({ visible }: { visible: boolean }) => <div data-sidebar-visible={String(visible)} /> }))
vi.mock('@/components/Terminal', () => ({ TerminalView: () => <main>终端工作区</main> }))
vi.mock('@/components/Terminal/SplitControls', () => ({ TerminalSplitMenu: () => null }))
vi.mock('@/components/Terminal/TunnelDialog', () => ({ TunnelDialog: () => null, TunnelPrompts: () => null }))
vi.mock('@/components/StatusBar', () => ({ StatusBar: () => null }))
vi.mock('@/components/CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => null }))
vi.mock('@/components/SyncIndicator', () => ({ SyncIndicator: () => null }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('@/hooks/useWindowControls', () => ({ useWindowControls: () => ({ desktop: false, mac: false, showControls: false }) }))
vi.mock('@/store/settings', () => ({
  useSettingsStore: (selector?: (state: object) => unknown) => {
    const state = { sidebarWidth: 240, setSidebarWidth: vi.fn(), theme: 'light', systemRevision: 0 }
    return selector ? selector(state) : state
  },
}))

import { Layout } from './index'
import { executeDesktopAction } from '@/lib/desktopActions'
import { useSessionStore } from '@/store/session'
import { useProfileStore } from '@/store/profile'
import { resetTerminalLayout, useTerminalLayoutStore } from '@/store/terminalLayout'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
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
  resetTerminalLayout()
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useProfileStore.setState(useProfileStore.getInitialState(), true)
})

function sidebar() { return host.querySelector<HTMLElement>('.eizhu-sidebar')! }
function toggle() { return host.querySelector<HTMLButtonElement>('.header-left button')! }

it.each([false, true])('分屏强制收起并锁定侧栏，退出后恢复原来的折叠状态 %s', async (collapsed) => {
  await act(async () => root.render(<Layout />))
  if (collapsed) await act(async () => executeDesktopAction('sidebar'))
  expect(sidebar().classList.contains('collapsed')).toBe(collapsed)

  await act(async () => useTerminalLayoutStore.getState().split('horizontal'))
  expect(sidebar().classList.contains('collapsed')).toBe(true)
  expect(sidebar().hasAttribute('inert')).toBe(true)
  expect(host.querySelector('[data-sidebar-visible="false"]')).not.toBeNull()
  expect(toggle().disabled).toBe(true)
  expect(toggle().title).toBe('分屏模式下侧栏已禁用')
  expect(host.querySelector('.sidebar-resizer')).toBeNull()

  await act(async () => {
    await executeDesktopAction('sidebar')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, shiftKey: true, bubbles: true }))
    toggle().click()
  })
  expect(sidebar().classList.contains('collapsed')).toBe(true)
  await act(async () => useTerminalLayoutStore.getState().maximize())
  expect(toggle().disabled).toBe(true)

  await act(async () => useTerminalLayoutStore.getState().merge())
  expect(toggle().disabled).toBe(false)
  expect(sidebar().classList.contains('collapsed')).toBe(collapsed)
  expect(sidebar().hasAttribute('inert')).toBe(collapsed)
  await act(async () => executeDesktopAction('sidebar'))
  expect(sidebar().classList.contains('collapsed')).toBe(!collapsed)
})

it('关闭到只剩一个窗格后自动解除侧栏锁定', async () => {
  await act(async () => root.render(<Layout />))
  await act(async () => useTerminalLayoutStore.getState().split('vertical'))
  expect(toggle().disabled).toBe(true)
  await act(async () => useSessionStore.getState().closeTab(useSessionStore.getState().activeTabId!))
  expect(toggle().disabled).toBe(false)
  expect(sidebar().classList.contains('collapsed')).toBe(false)
  expect(sidebar().hasAttribute('inert')).toBe(false)
})

it('已有分屏布局首次渲染时侧栏就处于收起和禁用状态', async () => {
  useTerminalLayoutStore.getState().split('horizontal')
  await act(async () => root.render(<Layout />))
  expect(toggle().disabled).toBe(true)
  expect(sidebar().classList.contains('collapsed')).toBe(true)
  expect(sidebar().hasAttribute('inert')).toBe(true)
})
