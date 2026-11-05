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
const onError = vi.fn()
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
  expect(host.querySelector('[role="img"][aria-label="AI 头像"]')).not.toBeNull()
  expect(host.querySelectorAll('.ai-code-number')).toHaveLength(2)
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="复制代码"]')!.click())
  expect(api.clipboard.write).toHaveBeenCalledWith({ text: 'SELECT name\nFROM users;\n' })
  expect(host.querySelector('[role="status"]')?.textContent).toBe('已复制')
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
it('execution history shows a collapsed command and status without raw output or approval actions', async () => {
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
  expect(host.querySelector<HTMLDetailsElement>('.ai-command')?.open).toBe(false)
  expect(host.querySelector('summary')?.textContent).toContain('退出码 1')
  expect(host.querySelector('.ai-command-status')?.getAttribute('data-attention')).toBe('true')
  expect(host.textContent).not.toContain('第一行')
  expect(host.textContent).not.toContain('warning')
  expect(host.querySelector('.ai-approval,.ai-reply-actions,.ai-result')).toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="复制命令"]')!.click())
  expect(api.clipboard.write).toHaveBeenLastCalledWith({ text: "printf '你好'" })
})

it('Markdown tables keep cell formatting and unsafe links cannot escape the desktop boundary', async () => {
  await render({
    id: 'm',
    role: 'assistant',
    text: '| 容器 | 状态 | 端口 |\n| --- | --- | --- |\n| **redis** | 运行中 | `6379` |\n| [postgres](javascript:alert) | 运行中 | 5432 |',
  })
  expect(host.querySelectorAll('th')).toHaveLength(3)
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2)
  expect(host.querySelector('td strong')?.textContent).toBe('redis')
  expect(host.querySelector('td code')?.textContent).toBe('6379')
  expect(host.querySelector('.ai-table-scroll')?.getAttribute('tabindex')).toBe('0')
  expect(host.querySelector('a')).toBeNull()
})

it.each([
  ['pending', '等待确认'],
  ['running', '执行中'],
  ['completed', '已完成'],
  ['unknown', '结果未知'],
  ['rejected', '已拒绝'],
  ['expired', '已失效'],
] as const)('command state %s remains visible without exposing approval buttons', async (state, label) => {
  await render({
    id: 'm',
    role: 'assistant',
    text: '',
    proposal: {
      id: 'p',
      command: 'pwd',
      cwd: '/tmp',
      purpose: '查看目录',
      impact: '只读',
      timeoutSeconds: 60,
      state,
    },
  })
  expect(host.querySelector('summary')?.textContent).toContain(label)
  expect(host.querySelector('.ai-command')?.querySelector('button:not([aria-label="复制命令"])')).toBeNull()
  if (state === 'unknown') expect(host.querySelector('.ai-command-notice')?.textContent).toContain('终端核查')
})
