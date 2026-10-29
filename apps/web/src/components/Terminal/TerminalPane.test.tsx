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
vi.mock('@/components/Terminal/AuthPromptDialog', () => ({ AuthPromptDialog: () => null }))

let host: HTMLDivElement, root: Root
function View() {
  const tab = useSessionStore((state) => state.tabs[0])
  return <TerminalPane tab={tab} isActive={false} isVisible={false} />
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

it('cancels the active connection and retry countdown without removing its tab, ignores late events, and permits manual reconnect', async () => {
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
  expect(useSessionStore.getState().activeTabId).toBe('tab')
  expect(useSessionStore.getState().tabs).toHaveLength(1)
  expect(useSessionStore.getState().tabs[0]).toMatchObject({
    id: 'tab',
    status: 'disconnected',
    sessionId: null,
    manualConnect: true,
    reconnectAttempt: undefined,
    nextRetryAt: undefined,
  })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await message({ type: 'error', payload: { code: 'SSH_NETWORK_ERROR', message: '迟到的连接错误' } })
  await message({
    type: 'metadata',
    payload: { session_id: 'ssh', host: 'example.test', username: 'user', protocol: 'ssh' },
  })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(useSessionStore.getState().tabs[0].status).toBe('disconnected')
  await act(async () =>
    [...document.querySelectorAll('button')].find((button) => button.textContent === '连接服务器')!.click(),
  )
  expect(sessionApi.create).toHaveBeenCalledOnce()
  expect(useSessionStore.getState().tabs[0]).toMatchObject({
    sessionId: 'new-ssh',
    status: 'connecting',
    manualConnect: false,
  })
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
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
  expect(useSessionStore.getState().tabs[0]).toMatchObject({
    id: 'tab',
    status: 'disconnected',
    sessionId: null,
  })
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
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ status: 'disconnected', sessionId: null })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
