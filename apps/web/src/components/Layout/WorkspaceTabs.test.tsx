// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSessionStore, type SessionTab } from '@/store/session'
import { useProfileStore } from '@/store/profile'
import { resetTerminalLayout, useTerminalLayoutStore } from '@/store/terminalLayout'
import { resetWorkspaceView, useWorkspaceViewStore } from '@/store/workspaceView'
import { WorkspaceTabs } from './WorkspaceTabs'
import { ConnectionPicker } from '@/components/Terminal/ConnectionPicker'

vi.mock('@/api/session', () => ({ sessionApi: { close: vi.fn().mockResolvedValue(undefined) } }))
const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: reportError } }))

const terminal = (id: string, extra: Partial<SessionTab> = {}): SessionTab => ({ id, profileId: 'p', profileName: 'Aliyun', sessionId: null, status: 'connected', ...extra })
let host: HTMLDivElement
let root: Root
let resized: () => void
const scrollIntoView = vi.fn()
beforeEach(async () => {
  await resetWorkspaceView()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback }
    observe() {} unobserve() {} disconnect() {}
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0 })
  Element.prototype.scrollIntoView = scrollIntoView
  scrollIntoView.mockClear()
  reportError.mockClear()
  resetTerminalLayout()
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useProfileStore.setState({ profiles: [] })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  resetTerminalLayout()
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const render = async (tabs: SessionTab[], activeTabId = tabs[0]?.id ?? null) => {
  useSessionStore.setState({ tabs, activeTabId })
  await act(async () => root.render(<TooltipProvider><WorkspaceTabs /></TooltipProvider>))
}
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
const key = async (button: HTMLElement, value: string) => act(async () => button.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })))

it('SSH 标签仅显示延迟色点或状态图标，完整状态保留在无障碍名称中，草稿不显示连接信息', async () => {
  await render([
    terminal('a', { latency: 32 }), terminal('b', { latency: 0 }), terminal('c'),
    terminal('d', { status: 'connecting', latency: 88 }),
    terminal('e', { status: 'reconnecting', reconnectAttempt: 2, latency: 88 }),
    terminal('f', { status: 'disconnected', latency: 88 }),
    terminal('g', { status: 'error', latency: 88, errorMessage: '认证失败' }),
    terminal('draft', { profileId: '', profileName: '新连接', status: 'disconnected' }),
    terminal('h', { latency: 100 }), terminal('i', { latency: 101 }),
    terminal('j', { latency: 300 }), terminal('k', { latency: 301 }),
  ])
  expect(buttons().map((button) => button.querySelector('.shell-tab-status')?.firstElementChild?.getAttribute('class') ?? '')).toEqual([
    'shell-connection-dot is-good', 'shell-connection-dot is-good', 'shell-connection-dot',
    expect.stringContaining('shell-connection-pending'), expect.stringContaining('shell-connection-pending'),
    'shell-connection-dot', expect.stringContaining('shell-connection-error'), '',
    'shell-connection-dot is-good', 'shell-connection-dot is-fair',
    'shell-connection-dot is-fair', 'shell-connection-dot is-slow',
  ])
  expect(buttons().every((button) => !button.querySelector('.shell-tab-status')?.textContent)).toBe(true)
  expect(buttons().slice(0, 8).map((button) => button.getAttribute('aria-label'))).toEqual([
    'Aliyun (1) · 32 ms', 'Aliyun (2) · 0 ms', 'Aliyun (3) · 已连接',
    'Aliyun (4) · 连接中…', 'Aliyun (5) · 重连中 (2)', 'Aliyun (6) · 已断开', 'Aliyun (7) · 连接失败', '新连接',
  ])
  const first = buttons()[0]
  await act(async () => useSessionStore.getState().updateTabLatency('a', 123))
  expect(buttons()[0]).toBe(first)
  expect(buttons()[0].querySelector('.shell-connection-dot')?.classList.contains('is-fair')).toBe(true)
  expect(buttons()[0].getAttribute('aria-label')).toContain('123 ms')
  expect(buttons()[1].getAttribute('aria-label')).toContain('0 ms')
  expect(scrollIntoView).toHaveBeenCalledTimes(1)
})

it('左右及 Home/End 自动切换并移动焦点，同名标签保留编号，分屏焦点与选中态同步', async () => {
  await render([terminal('a'), terminal('b'), terminal('c')])
  expect(buttons()[0].textContent).toContain('Aliyun (1)')
  expect(buttons()[1].textContent).toContain('Aliyun (2)')
  expect(buttons().map((button) => button.tabIndex)).toEqual([0, -1, -1])
  await key(buttons()[0], 'ArrowLeft')
  expect(document.activeElement).toBe(buttons()[2])
  expect(useSessionStore.getState().activeTabId).toBe('c')
  await key(buttons()[2], 'ArrowRight')
  expect(document.activeElement).toBe(buttons()[0])
  await key(buttons()[0], 'End')
  expect(document.activeElement).toBe(buttons()[2])
  await key(buttons()[2], 'Home')
  expect(document.activeElement).toBe(buttons()[0])
  await act(async () => useTerminalLayoutStore.getState().split('horizontal'))
  await act(async () => useTerminalLayoutStore.getState().focusNext(-1))
  expect(host.querySelector('[aria-selected="true"]')?.id).toBe('workspace-tab-a')
  expect(useTerminalLayoutStore.getState().focusedId).toBe('a')
  await act(async () => buttons()[1].click())
  expect(useTerminalLayoutStore.getState().focusedId).toBe('b')
})

it('关闭后台标签不激活它，关闭当前标签沿用现有选择规则并恢复焦点，清空后聚焦新增入口', async () => {
  await render([terminal('a'), terminal('b'), terminal('c')])
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭 Aliyun (2)"]')!.click())
  expect(useSessionStore.getState().activeTabId).toBe('a')
  const close = host.querySelector<HTMLButtonElement>('[aria-label="关闭 Aliyun (1)"]')!
  await act(async () => { close.focus(); close.click() })
  expect(useSessionStore.getState().activeTabId).toBe('c')
  expect(document.activeElement).toBe(buttons()[0])
  const last = host.querySelector<HTMLButtonElement>('[aria-label="关闭 Aliyun"]')!
  await act(async () => { last.focus(); last.click() })
  expect(buttons()).toHaveLength(0)
  expect(document.activeElement).toBe(host.querySelector('.shell-tab-add'))
  await act(async () => host.querySelector<HTMLButtonElement>('.shell-tab-add')!.click())
  expect(buttons()[0].textContent).toBe('新连接')
})

it('工具页不进入标签栏且不选中后台终端，键盘或点击可返回已有终端', async () => {
  await render([terminal('a'), terminal('b')])
  await act(async () => useWorkspaceViewStore.getState().openVault())
  expect(buttons()).toHaveLength(2)
  expect(host.textContent).not.toContain('密钥管理')
  expect(buttons().every((button) => button.getAttribute('aria-selected') === 'false')).toBe(true)
  expect(buttons()[0].tabIndex).toBe(0)
  await key(buttons()[0], 'ArrowRight')
  expect(useWorkspaceViewStore.getState().activePage).toBe('terminal')
  expect(buttons()[1].getAttribute('aria-selected')).toBe('true')
  await act(async () => useWorkspaceViewStore.getState().openVault())
  await act(async () => buttons()[0].click())
  expect(useSessionStore.getState().activeTabId).toBe('a')
  expect(useWorkspaceViewStore.getState().activePage).toBe('terminal')
})

it('溢出时滚轮横向滚动，横向触控板与缩放保持原生行为；尺寸变化露出当前标签', async () => {
  await render(Array.from({ length: 20 }, (_, index) => terminal(String(index))), '19')
  const scroll = host.querySelector<HTMLDivElement>('.shell-tab-scroll')!
  Object.defineProperties(scroll, { scrollWidth: { value: 4000 }, clientWidth: { value: 400 } })
  const wheel = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true })
  scroll.dispatchEvent(wheel)
  expect(wheel.defaultPrevented).toBe(true)
  expect(scroll.scrollLeft).toBe(80)
  const horizontal = new WheelEvent('wheel', { deltaX: 80, deltaY: 2, bubbles: true, cancelable: true })
  scroll.dispatchEvent(horizontal)
  expect(horizontal.defaultPrevented).toBe(false)
  const zoom = new WheelEvent('wheel', { deltaY: 80, ctrlKey: true, cancelable: true })
  scroll.dispatchEvent(zoom)
  expect(zoom.defaultPrevented).toBe(false)
  scrollIntoView.mockClear()
  resized()
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
})

it('完整名称、地址与错误通过键盘聚焦提示，标签与内容区域具有固定关联', async () => {
  await render([terminal('a', { profileName: '很长的生产服务器名称', host: 'example.test', port: 2200, username: 'deploy', status: 'error', errorMessage: '认证失败' })])
  expect(buttons()[0].getAttribute('aria-controls')).toBe('workspace-panel-a')
  await act(async () => buttons()[0].focus())
  const tooltip = document.querySelector('[role="tooltip"]')!
  expect(tooltip.textContent).toContain('很长的生产服务器名称 · deploy@example.test:2200 · 连接失败')
  expect(tooltip.textContent).toContain('认证失败')
})

it('键盘切换草稿时选择器不抢走 Tab 焦点，页面输入和节点保持不变', async () => {
  function Drafts() {
    const { tabs, activeTabId } = useSessionStore()
    return <><WorkspaceTabs />{tabs.map((tab) => <div key={tab.id} hidden={tab.id !== activeTabId}><ConnectionPicker tabId={tab.id} isActive={tab.id === activeTabId} /></div>)}</>
  }
  useSessionStore.setState({ tabs: [terminal('a', { profileId: '' }), terminal('b', { profileId: '' })], activeTabId: 'a' })
  await act(async () => root.render(<TooltipProvider><Drafts /></TooltipProvider>))
  const input = host.querySelector<HTMLInputElement>('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '保留搜索')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => buttons()[0].focus())
  await key(buttons()[0], 'ArrowRight')
  expect(document.activeElement).toBe(buttons()[1])
  await key(buttons()[1], 'ArrowLeft')
  expect(document.activeElement).toBe(buttons()[0])
  expect(host.querySelector('input')).toBe(input)
  expect(input.value).toBe('保留搜索')
})
