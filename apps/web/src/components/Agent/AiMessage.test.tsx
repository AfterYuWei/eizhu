// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AiConversation } from '@eizhu/contracts'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AiMessage } from './AiMessage'

const api = vi.hoisted(() => ({
  clipboard: { write: vi.fn() },
  system: { openExternal: vi.fn() },
}))
vi.mock('@/lib/bridge', () => ({ bridge: () => api }))
let host: HTMLDivElement, root: Root
const onDecide = vi.fn(),
  onError = vi.fn()
const target = {
  profileId: 'p',
  sessionId: 's',
  host: 'example.invalid',
  port: 22,
  username: 'deploy',
  cwd: '/tmp',
  system: '',
}
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
})
const render = (message: AiConversation['messages'][number]) =>
  act(async () =>
    root.render(
      <TooltipProvider>
        <AiMessage
          message={message}
          target={target}
          busy={false}
          onError={onError}
          onAsk={() => {}}
          onContinue={() => {}}
          onDecide={onDecide}
          onTimeout={() => {}}
        />
      </TooltipProvider>,
    ),
  )

it('Markdown code is copied without surrounding reply, language label or displayed line numbers', async () => {
  await render({
    id: 'm',
    role: 'assistant',
    text: '## 统计口径\n\n说明 **加粗**，保留 `inline`。\n\n- 第一项\n- 第二项\n\n```sql\nSELECT name\nFROM users;\n```',
  })
  expect(host.querySelector('h2')?.textContent).toBe('统计口径')
  expect(host.querySelectorAll('li')).toHaveLength(2)
  expect(host.querySelector('.ai-avatar')?.textContent).toBe('AI')
  expect(host.querySelectorAll('.ai-code-number')).toHaveLength(2)
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="复制代码"]')!.click())
  expect(api.clipboard.write).toHaveBeenCalledWith({ text: 'SELECT name\nFROM users;\n' })
  expect(host.querySelector('[role="status"]')?.textContent).toBe('已复制')
  expect(onDecide).not.toHaveBeenCalled()
})
it('untrusted Markdown cannot create scripts, remote images or javascript links; HTTP links use the desktop boundary', async () => {
  await render({
    id: 'm',
    role: 'assistant',
    text: '<script>alert(1)</script>\n\n![remote](https://example.invalid/pixel.png)\n\n[unsafe](javascript:alert(1))\n\n[documentation](https://example.invalid/docs)',
  })
  expect(host.querySelector('script,img,iframe')).toBeNull()
  expect(host.querySelector('[href^="javascript:"]')).toBeNull()
  await act(async () => host.querySelector<HTMLAnchorElement>('a')!.click())
  expect(api.system.openExternal).toHaveBeenCalledWith({ url: 'https://example.invalid/docs' })
})
it('command and each output block copy only their original bytes represented as text', async () => {
  await render({
    id: 'm',
    role: 'assistant',
    text: '检查结果',
    proposal: {
      id: 'p',
      command: "printf '你好'",
      cwd: '/tmp',
      purpose: '读取状态',
      impact: '只读',
      timeoutSeconds: 60,
      state: 'completed',
      result: {
        status: 'completed',
        stdout: '第一行\n  第二行\n',
        stderr: 'warning\n',
        exitCode: 1,
        elapsedMs: 13,
        truncated: false,
        message: '',
      },
    },
  })
  for (const [label, content] of [
    ['命令', "printf '你好'"],
    ['标准输出', '第一行\n  第二行\n'],
    ['错误输出', 'warning\n'],
  ]) {
    await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="复制${label}"]`)!.click())
    expect(api.clipboard.write).toHaveBeenLastCalledWith({ text: content })
  }
  expect(onDecide).not.toHaveBeenCalled()
})
