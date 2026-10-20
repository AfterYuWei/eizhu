// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
const { listenMock } = vi.hoisted(() => ({ listenMock: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))
vi.mock('./AuthPromptDialog', () => ({ AuthPromptDialog: ({ request }: { request?: { name: string } }) => request ? <p>{request.name}</p> : null }))
vi.mock('@/components/ConnectionDialog', () => ({ ConnectionDialog: () => null }))
import { TunnelPrompts } from './TunnelDialog'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
it('并发隧道认证排队，结束通知清除旧请求，过滤旧账号事件', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setWorkspaceGeneration(1)
  let deliver: (event: { payload: unknown }) => void = () => undefined
  const stop = vi.fn(); listenMock.mockImplementation(async (_name, callback) => { deliver = callback; return stop })
  const host = document.createElement('div'), root = createRoot(host)
  await act(async () => root.render(<TunnelPrompts />))
  const message = (type: string, id: string, name = id) => ({ payload: { workspaceGeneration: 1, session_id: id, type, payload: { request_id: id, name, prompts: [] } } })
  await act(async () => { deliver(message('tunnel_auth_request', 'one')); deliver(message('tunnel_auth_request', 'two')) })
  expect(host.textContent).toBe('one')
  await act(async () => deliver(message('tunnel_auth_closed', 'one')))
  expect(host.textContent).toBe('two')
  await act(async () => deliver(message('tunnel_auth_closed', 'two')))
  setWorkspaceGeneration(2)
  await act(async () => deliver(message('tunnel_auth_request', 'old')))
  expect(host.textContent).toBe('')
  await act(async () => root.unmount()); expect(stop).toHaveBeenCalledOnce()
})
