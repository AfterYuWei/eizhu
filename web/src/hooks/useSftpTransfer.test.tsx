// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
const { listenMock } = vi.hoisted(() => ({ listenMock: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))
import { useSftpTransfer } from './useSftpTransfer'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
afterEach(() => vi.resetAllMocks())
describe('空间内多会话传输事件', () => {
  it('订阅全部任务，过滤会话状态和旧空间，并卸载监听', async () => {
    setWorkspaceGeneration(1)
    let deliver: (event: { payload: unknown }) => void = () => undefined
    const unlisten = vi.fn()
    listenMock.mockImplementation(async (_name, callback) => { deliver = callback; return unlisten })
    const onTask = vi.fn(), onSessionStatus = vi.fn()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    function Test() { useSftpTransfer(['session-1', 'session-2'], { onTask, onSessionStatus }); return null }
    await act(async () => root.render(<Test />))
    expect(listenMock).toHaveBeenCalledOnce()
    act(() => {
      for (const id of ['session-1', 'session-2']) deliver({ payload: { workspaceGeneration: 1, type: 'transfer_updated', payload: { session_id: id, id, file_name: 'a', status: 'paused', execution_generation: 2 } } })
      deliver({ payload: { workspaceGeneration: 1, type: 'sftp_session_status', payload: { session_id: 'other', status: 'connected' } } })
      deliver({ payload: { workspaceGeneration: 1, type: 'sftp_session_status', payload: { session_id: 'session-2', status: 'connected' } } })
      setWorkspaceGeneration(2)
      deliver({ payload: { workspaceGeneration: 1, type: 'transfer_updated', payload: { id: 'old', file_name: 'a', status: 'completed' } } })
    })
    expect(onTask.mock.calls.map(([task]) => task.id)).toEqual(['session-1', 'session-2'])
    expect(onSessionStatus).toHaveBeenCalledExactlyOnceWith('session-2', 'connected')
    await act(async () => root.unmount())
    host.remove()
    expect(unlisten).toHaveBeenCalledOnce()
  })
})
