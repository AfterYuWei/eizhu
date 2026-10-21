// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useCompletion } from './useCompletion'
vi.mock('@/lib/commandHistory', () => ({ recordCommand: vi.fn(), queryHistory: () => [], reliableHistoryCommand: () => null }))
afterEach(() => vi.useRealTimers())
it('静态立即展示、动态异步加入，拒绝旧响应并保留远端 Tab', async () => {
  vi.useFakeTimers()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div'); const root = createRoot(host)
  const sendComplete = vi.fn(), sendInput = vi.fn()
  let completion: ReturnType<typeof useCompletion>
  let connectionKey = 'one'
  function Test() {
    completion = useCompletion({ getTerminal: () => null, sendComplete, sendInput, getCwd: () => '/srv', enabled: true, profileId: 'p', tabId: 't', connectionKey })
    return null
  }
  await act(async () => root.render(<Test />))
  await act(async () => { completion.handleData('git checkout '); vi.advanceTimersByTime(120) })
  expect(completion!.popup.columns[0].suggestions.map((s) => s.name)).toContain('-b')
  const [first] = sendComplete.mock.calls.at(-1)!
  await act(async () => completion.handleCompleteResponse({ request_id: first, output: 'feature/a\nfeature/b', error: '', exit_code: 0 }))
  expect(completion!.popup.columns[0].suggestions.map((s) => s.name)).toContain('feature/a')
  await act(async () => { completion.handleData('f'); vi.advanceTimersByTime(120) })
  await act(async () => { expect(completion!.handleData('\t')).toBe(false) })
  expect(sendInput).not.toHaveBeenCalled()
  connectionKey = 'two'
  await act(async () => root.render(<Test />))
  await act(async () => completion.handleCompleteResponse({ request_id: first, output: 'old', error: '', exit_code: 0 }))
  expect(completion!.popup.open).toBe(false)
  await act(async () => root.unmount())
})
