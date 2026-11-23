// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sessionApi } from '@/api/session'
import type { SessionMessage } from '@/types/sessionMessage'
import { useSessionChannel } from './useSessionChannel'

vi.mock('@/api/session', () => ({
  sessionApi: { subscribe: vi.fn(), unsubscribe: vi.fn(), input: vi.fn() },
}))

let host: HTMLDivElement, root: Root
let dispatch: (message: SessionMessage) => void | Promise<void>
let channel: ReturnType<typeof useSessionChannel>
function View() {
  const result = useSessionChannel({ sessionId: 'ssh' })
  useEffect(() => { channel = result })
  return null
}
beforeEach(async () => {
  vi.resetAllMocks()
  vi.mocked(sessionApi.subscribe).mockImplementation(async (_id, callback) => {
    dispatch = callback
    return 'subscription'
  })
  vi.mocked(sessionApi.unsubscribe).mockResolvedValue(undefined)
  vi.mocked(sessionApi.input).mockResolvedValue(undefined)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<View />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

it.each(['exit', 'disconnect', 'error'] as const)('同 ID 重连在 %s 后恢复输入通道，无需重新订阅', async (type) => {
  expect(channel.status).toBe('connected')
  await act(async () => dispatch({ type }))
  expect(channel.status).toBe('disconnected')
  await act(async () => dispatch({ type: 'connection_state', payload: { session_id: 'ssh', status: 'connecting', stage: 'preparing' } }))
  expect(channel.status).toBe('connecting')
  await act(async () => dispatch({ type: 'metadata', payload: { session_id: 'ssh', profile_id: 'server', profile_name: '服务器', host: 'example.test', port: 22, username: 'user', protocol: 'ssh' } }))
  expect(channel.status).toBe('connected')
  channel.sendInput('pwd\r')
  expect(sessionApi.input).toHaveBeenCalledExactlyOnceWith('ssh', 'pwd\r')
  expect(sessionApi.subscribe).toHaveBeenCalledTimes(1)
})
