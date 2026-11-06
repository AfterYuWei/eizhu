// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AiMessage } from './AiMessage'
import type { AiConversation } from '@eizhu/contracts'
const api = vi.hoisted(() => ({ clipboard: { write: vi.fn() }, system: { openExternal: vi.fn() } }))
vi.mock('@/lib/bridge', () => ({ bridge: () => api }))
let host: HTMLDivElement, root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  api.clipboard.write.mockResolvedValue(undefined)
  api.system.openExternal.mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
})
const render = (
  message: AiConversation['messages'][number],
  timing: { busy?: boolean; startedAt?: number; completedAt?: number } = {},
) =>
  act(async () =>
    root.render(
      <TooltipProvider>
        <AiMessage messages={[message]} {...timing} onError={() => {}} />
      </TooltipProvider>,
    ),
  )
it('updates elapsed time beside the AI name and freezes at the persisted completion time', async () => {
  vi.useFakeTimers()
  const startedAt = Date.UTC(2026, 10, 6, 6)
  vi.setSystemTime(startedAt + 64000)
  const message = { id: 'm', role: 'assistant' as const, text: '正在检查' }
  await render(message, { startedAt, busy: true })
  expect(host.querySelector('.ai-message-role time')?.textContent).toBe('已处理 1 分 4 秒')
  await act(async () => vi.advanceTimersByTime(2000))
  expect(host.querySelector('time')?.textContent).toBe('已处理 1 分 6 秒')
  await render(message, { startedAt, completedAt: startedAt + 387000 })
  expect(host.querySelector('time')?.textContent).toBe('耗时 6 分 27 秒')
  expect(host.querySelector('time')?.getAttribute('datetime')).toBe('PT387S')
  await act(async () => vi.advanceTimersByTime(10000))
  expect(host.querySelector('time')?.textContent).toBe('耗时 6 分 27 秒')
  expect(vi.getTimerCount()).toBe(0)
})
it('does not invent elapsed time for old history or a run interrupted by a restart', async () => {
  const message = { id: 'm', role: 'assistant' as const, text: '历史回复' }
  await render(message)
  expect(host.querySelector('time')).toBeNull()
  await render(message, { startedAt: Date.now() - 3600000 })
  expect(host.querySelector('time')).toBeNull()
})
it('renders analysis, GFM tables and exact code copy', async () => {
  await render({
    id: 'm',
    role: 'assistant',
    text: '## 检查结论\n\n| 项目 | 状态 |\n| --- | --- |\n| 服务 | 正常 |\n\n```sh\nprintf hello\n```',
  })
  expect(host.querySelector('h2')?.textContent).toBe('检查结论')
  expect(host.querySelector('table')).not.toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="复制代码"]')!.click())
  expect(api.clipboard.write).toHaveBeenCalledWith({ text: 'printf hello\n' })
})
it('untrusted Markdown cannot inject scripts, remote images or javascript URLs', async () => {
  await render({
    id: 'm',
    role: 'assistant',
    text: '<script>alert(1)</script>\n\n![remote](https://example.invalid/a.png)\n\n[bad](javascript:alert(1))\n\n[docs](https://example.invalid/docs)',
  })
  expect(host.querySelector('script,img,iframe,[href^="javascript:"]')).toBeNull()
  await act(async () => host.querySelector<HTMLAnchorElement>('a')!.click())
  expect(api.system.openExternal).toHaveBeenCalledWith({ url: 'https://example.invalid/docs' })
})
it('tool records expose operation, result and unknown status without replay controls', async () => {
  await render({
    id: 'm',
    role: 'tool',
    text: '',
    tool: {
      id: 'call',
      name: 'terminal_execute',
      args: {},
      state: 'unknown',
      preview: 'printf hello',
      error: '请在终端核查',
      result: { stdout: 'partial' },
    },
  })
  expect(host.textContent).toContain('结果未知')
  expect(host.textContent).toContain('partial')
  expect(host.textContent).toContain('请在终端核查')
  expect(host.textContent).not.toContain('重试')
})
