// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SessionMessage } from '@/types/sessionMessage'
import { useSessionStore } from '@/store/session'
import { TerminalPane } from './TerminalPane'
import { sessionApi } from '@/api/session'
import { terminalActions } from '@/lib/terminalActions'

const mocks = vi.hoisted(() => ({
  onMessage: undefined as ((message: SessionMessage) => void) | undefined,
  terminal: {
    write: vi.fn(),
    writeln: vi.fn(),
    clear: vi.fn(),
    reset: vi.fn(),
    fit: vi.fn(),
    getSize: () => ({ cols: 80, rows: 24 }),
    getTerminal: () => null,
  },
  channel: {
    status: 'connected',
    latency: null,
    sendInput: vi.fn(),
    sendResize: vi.fn(),
    sendComplete: vi.fn(),
  },
  completion: {
    popup: null,
    handleData: vi.fn(),
    reset: vi.fn(),
    handleCompleteResponse: vi.fn(),
    handleOutputData: vi.fn(),
    hoverSelect: vi.fn(),
    clickSelect: vi.fn(),
    expandDirectory: vi.fn(),
  },
}))
vi.mock('@/hooks/useTerminal', () => ({ useTerminal: () => mocks.terminal }))
vi.mock('@/api/session', () => ({
  sessionApi: { close: vi.fn(), create: vi.fn(), reconnect: vi.fn(), decideHostKey: vi.fn() },
}))
vi.mock('@/hooks/useCompletion', () => ({ useCompletion: () => mocks.completion }))
vi.mock('@/hooks/useSessionChannel', () => ({
  useSessionChannel: (options: { onMessage: (message: SessionMessage) => void }) => {
    mocks.onMessage = options.onMessage
    return mocks.channel
  },
}))
vi.mock('@/store/history', () => ({ useHistoryStore: { getState: () => ({ load: async () => {} }) } }))
vi.mock('@/components/Terminal/CompletionPanel', () => ({ CompletionPanel: () => null }))

let host: HTMLDivElement, root: Root
function View() {
  const tab = useSessionStore((state) => state.tabs[0])
  return tab ? <TerminalPane tab={tab} isActive={false} isVisible={false} /> : null
}
const message = async (payload: SessionMessage) => act(async () => mocks.onMessage!(payload))
beforeEach(async () => {
  vi.resetAllMocks()
  vi.mocked(sessionApi.close).mockResolvedValue(undefined)
  vi.mocked(sessionApi.create).mockResolvedValue({ session_id: 'new-ssh', status: 'connecting' })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  useSessionStore.setState({
    tabs: [{ id: 'tab', profileId: 'server', profileName: '服务器', sessionId: 'ssh', status: 'connecting' }],
    activeTabId: 'tab',
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<View />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('renders a replayed failure snapshot at host confirmation as an error without requiring a second error event', async () => {
  await message({
    type: 'connection_state',
    payload: {
      session_id: 'ssh',
      status: 'error',
      stage: 'hostkey_confirm',
      error: '服务器主机指纹未获确认',
      error_code: 'HOST_KEY_REJECTED',
      logs: [],
    },
  })
  expect(document.querySelector('.connection-live-logs')?.textContent).toContain('主机身份未通过确认')
  expect(document.querySelector('.connection-host-key')).toBeNull()
  expect(document.querySelector('.connection-live-logs')?.textContent).toContain('HOST_KEY_REJECTED')
})

it('保留连接就绪前上报的当前目录，并在重连开始时清除旧目录', async () => {
  await act(async () => useSessionStore.setState((state) => ({ tabs: state.tabs.map((tab) => ({ ...tab, detailAttached: true })) })))
  await message({ type: 'cwd', payload: { path: '/root' } })
  await message({ type: 'metadata', payload: { session_id: 'ssh', profile_id: 'server', profile_name: '服务器', host: 'example.test', port: 22, username: 'user', protocol: 'ssh' } })
  expect(useSessionStore.getState().tabs[0].cwd).toBe('/root')
  await message({ type: 'connection_state', payload: { session_id: 'ssh', status: 'reconnecting', stage: 'retry_wait', retry_attempt: 1, next_retry_at: Date.now() + 1000 } })
  expect(useSessionStore.getState().tabs[0].cwd).toBeUndefined()
  await message({ type: 'cwd', payload: { path: '/home/user' } })
  await message({ type: 'metadata', payload: { session_id: 'ssh', profile_id: 'server', profile_name: '服务器', host: 'example.test', port: 22, username: 'user', protocol: 'ssh' } })
  expect(useSessionStore.getState().tabs[0].cwd).toBe('/home/user')
})

it('按实际连接快照更新地址、端口与标签，忽略不属于当前会话的就绪消息', async () => {
  await act(async () => useSessionStore.setState((state) => ({ tabs: state.tabs.map((tab) => ({ ...tab, detailAttached: true, host: 'old.test', port: 22, username: 'old' })) })))
  const target = { profile_id: 'server', profile_name: '实际服务器', host: 'actual.test', port: 2222, username: 'actual' }
  await message({ type: 'connection_state', payload: { session_id: 'ssh', status: 'connecting', stage: 'preparing', target } })
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ profileName: '实际服务器', host: 'actual.test', port: 2222, username: 'actual' })
  await message({ type: 'metadata', payload: { ...target, session_id: 'other-ssh', protocol: 'ssh' } })
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ sessionId: 'ssh', status: 'connecting' })
  await message({ type: 'metadata', payload: { ...target, session_id: 'ssh', profile_id: 'other-server', protocol: 'ssh' } })
  expect(useSessionStore.getState().tabs[0].status).toBe('connecting')
  await message({ type: 'metadata', payload: { ...target, session_id: 'ssh', protocol: 'ssh' } })
  expect(useSessionStore.getState().tabs[0].status).toBe('connected')
})

it('标签已换绑时，旧订阅回调不能把它重新绑定回旧会话', async () => {
  const previous = mocks.onMessage!
  await act(async () => {
    useSessionStore.setState({ tabs: [{ id: 'tab', profileId: 'other-server', profileName: '服务器 B', sessionId: 'new-ssh', status: 'connecting' }] })
    previous({ type: 'metadata', payload: { session_id: 'ssh', profile_id: 'server', profile_name: '服务器 A', host: 'a.test', port: 22, username: 'a', protocol: 'ssh' } })
  })
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ profileId: 'other-server', profileName: '服务器 B', sessionId: 'new-ssh', status: 'connecting' })
})

it('changes from the retry countdown to the actual operation as soon as a new attempt starts', async () => {
  await message({
    type: 'connection_state',
    payload: {
      session_id: 'ssh',
      status: 'reconnecting',
      stage: 'retry_wait',
      retry_attempt: 2,
      next_retry_at: Date.now() + 10000,
      message: '等待重新连接',
    },
  })
  expect(document.querySelector('.connection-retry-status')?.textContent).toContain('第 2 次重连')
  await message({
    type: 'connection_state',
    payload: {
      session_id: 'ssh',
      status: 'connecting',
      stage: 'preparing',
      message: '正在读取服务器配置与认证方式',
      logs: [],
    },
  })
  expect(document.querySelector('.connection-status h2')?.textContent).toBe('读取连接配置')
  expect(document.querySelector('.connection-retry-status')).toBeNull()
  expect(document.querySelector('[role="progressbar"]')).not.toBeNull()
})

it('取消连接与重连倒计时后关闭标签，迟到事件不再恢复页面', async () => {
  await message({
    type: 'connection_state',
    payload: {
      session_id: 'ssh',
      status: 'reconnecting',
      stage: 'retry_wait',
      retry_attempt: 2,
      next_retry_at: Date.now() + 10000,
    },
  })
  await act(async () =>
    [...document.querySelectorAll('button')].find((button) => button.textContent === '取消连接')!.click(),
  )
  expect(sessionApi.close).toHaveBeenCalledExactlyOnceWith('ssh')
  expect(useSessionStore.getState().activeTabId).toBeNull()
  expect(useSessionStore.getState().tabs).toEqual([])
  expect(host.querySelector('.terminal-pane-root')).toBeNull()
  expect(terminalActions('tab')).toBeUndefined()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await message({ type: 'error', payload: { code: 'SSH_NETWORK_ERROR', message: '迟到的连接错误' } })
  await message({
    type: 'metadata',
    payload: { session_id: 'ssh', profile_id: 'server', profile_name: '服务器', host: 'example.test', port: 22, username: 'user', protocol: 'ssh' },
  })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(useSessionStore.getState().tabs).toEqual([])
  expect(sessionApi.create).not.toHaveBeenCalled()
  expect(document.body.textContent).not.toContain('连接服务器')
})

it('releases a session returned by a reconnect request after cancellation without reviving its tab', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof sessionApi.reconnect>>) => void
  vi.mocked(sessionApi.reconnect).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  let pending!: Promise<void>
  await act(async () => {
    pending = terminalActions('tab')!.reconnect()
  })
  await act(async () =>
    [...document.querySelectorAll('button')].find((button) => button.textContent === '取消连接')!.click(),
  )
  await act(async () => {
    resolve({ session_id: 'ssh', status: 'connecting' })
    await pending
  })
  expect(sessionApi.close).toHaveBeenCalledWith('ssh')
  expect(useSessionStore.getState().tabs).toEqual([])
  expect(useSessionStore.getState().activeTabId).toBeNull()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('keeps cancellation failures in the connection log and retains the session for another cancellation attempt', async () => {
  vi.mocked(sessionApi.close).mockRejectedValueOnce({
    error: { code: 'RUNTIME_UNAVAILABLE', message: '暂时无法停止连接，请重试' },
  })
  await act(async () =>
    [...document.querySelectorAll('button')].find((button) => button.textContent === '取消连接')!.click(),
  )
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ id: 'tab', sessionId: 'ssh', status: 'error' })
  expect(document.querySelector('.connection-live-logs')?.textContent).toContain('暂时无法停止连接，请重试')
  await act(async () =>
    [...document.querySelectorAll('button')].find((button) => button.textContent === '取消连接')!.click(),
  )
  expect(useSessionStore.getState().tabs).toEqual([])
  expect(useSessionStore.getState().activeTabId).toBeNull()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('主机指纹确认选择取消时关闭连接标签', async () => {
  await message({
    type: 'connection_state',
    payload: {
      session_id: 'ssh', status: 'connecting', stage: 'hostkey_confirm',
      host_key_request_id: 'hostkey-request', host_key_fingerprint: 'SHA256:test',
    },
  })
  await act(async () =>
    [...document.querySelectorAll('button')].find((button) => button.textContent === '取消连接')!.click(),
  )
  expect(sessionApi.decideHostKey).toHaveBeenCalledExactlyOnceWith('hostkey-request', 'SHA256:test', 'reject')
  expect(sessionApi.close).toHaveBeenCalledExactlyOnceWith('ssh')
  expect(useSessionStore.getState().tabs).toEqual([])
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('交互式认证选择取消时收起提示并关闭连接标签', async () => {
  await message({
    type: 'auth_request',
    payload: {
      request_id: 'auth-request', session_id: 'ssh', name: 'SSH 交互式认证', instructions: '',
      prompts: [{ prompt: '密码', echo: false }],
    },
  })
  expect(document.body.textContent).toContain('SSH 交互式认证')
  await act(async () =>
    [...document.querySelectorAll('button')].find((button) => button.textContent === '取消连接')!.click(),
  )
  expect(sessionApi.close).toHaveBeenCalledExactlyOnceWith('ssh')
  expect(useSessionStore.getState().tabs).toEqual([])
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('Escape 关闭连接失败对话框时也移除对应标签', async () => {
  await message({ type: 'error', payload: { code: 'SSH_AUTH_FAILED', message: '认证失败' } })
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  expect(sessionApi.close).toHaveBeenCalledExactlyOnceWith('ssh')
  expect(useSessionStore.getState().tabs).toEqual([])
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('连接成功后自动收起对话框，保留正常连接的标签', async () => {
  vi.useFakeTimers()
  await message({
    type: 'metadata',
    payload: { session_id: 'ssh', profile_id: 'server', profile_name: '服务器', host: 'example.test', port: 22, username: 'user', protocol: 'ssh' },
  })
  await act(async () => vi.advanceTimersByTime(700))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ id: 'tab', sessionId: 'ssh', status: 'connected' })
  expect(sessionApi.close).not.toHaveBeenCalled()
})
