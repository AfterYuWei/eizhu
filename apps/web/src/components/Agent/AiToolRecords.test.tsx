// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AiToolCall } from '@eizhu/contracts'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AiToolRecords } from './AiToolRecords'

const api = vi.hoisted(() => ({ clipboard: { write: vi.fn() } }))
vi.mock('@/lib/bridge', () => ({ bridge: () => api }))
let host: HTMLDivElement, root: Root
const command = 'docker ps -a --format "table {{.Names}}\\t{{.Status}}"\nprintf "你好\\n"\n'
const stdout = 'NAMES       STATUS\ngitlab      Up 2 days\nastrbot     Up 30 minutes\n'
const call: AiToolCall = {
  id: 'one',
  name: 'terminal_execute',
  sessionId: 'ssh',
  state: 'completed',
  error: '',
  args: {
    sessionId: 'ssh',
    command,
    cwd: '/root',
    purpose: '列出所有 Docker 容器',
    impact: '只读查询',
    timeoutSeconds: 60,
  },
  preview: '原始 JSON 参数预览',
  result: {
    status: 'completed',
    stdout,
    stderr: 'synthetic warning\n',
    exitCode: 3,
    elapsedMs: 311,
    truncated: false,
    message: '',
  },
}
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  api.clipboard.write.mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
const render = (calls: AiToolCall[]) =>
  act(async () =>
    root.render(
      <TooltipProvider>
        <AiToolRecords
          calls={calls}
          targets={[
            {
              sessionId: 'ssh',
              profileId: 'p',
              host: 'demo.invalid',
              username: 'root',
              port: 22,
              cwd: '/root',
              system: 'Linux',
            },
          ]}
          onError={() => {}}
        />
      </TooltipProvider>,
    ),
  )

it('prioritizes the exact command and decoded output while keeping raw parameters secondary', async () => {
  await render([call])
  expect(host.querySelector('.ai-tool-records > summary')?.textContent).toBe('列出所有 Docker 容器已完成')
  const content = host.querySelector('.ai-tool-record-content')!
  expect(content.querySelector('.ai-command-context')?.textContent).toContain(
    'root@demo.invalid:22目录：/root',
  )
  expect(content.querySelector('[aria-label="命令代码块"]')).not.toBeNull()
  const output = content.querySelector('[aria-label="输出代码块"]')!
  expect(output.querySelector('pre')?.textContent).toBe(stdout)
  expect(output.querySelector('.ai-code-number')).toBeNull()
  expect(output.classList.contains('is-wrapped')).toBe(false)
  expect(content.querySelector('.ai-command-result-meta')?.textContent).toBe('退出码 3耗时 311 毫秒')
  expect(content.querySelector('.ai-command-result-meta [data-attention=true]')?.textContent).toBe('退出码 3')
  expect(content.querySelector('.ai-command-stderr')?.textContent).toContain('synthetic warning')
  const raw = content.querySelector<HTMLDetailsElement>('.ai-command-raw')!
  expect(raw.open).toBe(false)
  expect(raw.textContent).toContain('sessionId')
  await act(async () => content.querySelector<HTMLButtonElement>('[aria-label="复制命令"]')!.click())
  expect(api.clipboard.write).toHaveBeenLastCalledWith({ text: command })
  await act(async () => content.querySelector<HTMLButtonElement>('[aria-label="复制输出"]')!.click())
  expect(api.clipboard.write).toHaveBeenLastCalledWith({ text: stdout })
})

it('keeps the expanded region, open records and scroll position when more calls arrive', async () => {
  await render([call])
  const group = host.querySelector<HTMLDetailsElement>('.ai-tool-records')!
  const region = host.querySelector<HTMLDivElement>('[role=region]')!
  const first = host.querySelector<HTMLDetailsElement>('.ai-tool-record')!
  await act(async () => {
    group.open = true
  })
  region.scrollTop = 120
  await render([call, { ...call, id: 'two', state: 'running' }])
  expect(host.querySelector('.ai-tool-records')).toBe(group)
  expect(group.open).toBe(true)
  expect(host.querySelector('[role=region]')).toBe(region)
  expect(region.scrollTop).toBe(120)
  expect(host.querySelector('.ai-tool-record')).toBe(first)
  expect(first.open).toBe(true)
  expect(group.querySelector(':scope > summary')?.textContent).toBe('执行记录（2 项）执行中')
})

it('initially shows a compact list for a group and retains prepared file diffs', async () => {
  const file: AiToolCall = {
    ...call,
    id: 'file',
    name: 'file_edit',
    args: { path: '/etc/demo.conf' },
    preview: '--- 修改前\nport=80\n+++ 修改后\nport=8080',
    result: { content: 'port=8080\n' },
  }
  await render([call, file])
  expect(
    [...host.querySelectorAll<HTMLDetailsElement>('.ai-tool-record')].every((record) => !record.open),
  ).toBe(true)
  const fileRecord = host.querySelectorAll('.ai-tool-record')[1]
  expect(fileRecord.querySelector('[aria-label="操作预览代码块"]')?.textContent).toContain('port=80')
  expect(fileRecord.querySelector('[aria-label="内容代码块"] pre')?.textContent).toBe('port=8080\n')
  expect(fileRecord.querySelector('summary')?.textContent).toContain('编辑文件 · /etc/demo.conf')
})

it('does not summarize a rejected call as completed when earlier calls succeeded', async () => {
  await render([call, { ...call, id: 'rejected', state: 'rejected' }])
  expect(host.querySelector('.ai-tool-records > summary')?.textContent).toBe('执行记录（2 项）已拒绝')
})

it('keeps unknown, truncated and retained excerpts explicit without inventing output or replay controls', async () => {
  await render([
    {
      ...call,
      state: 'unknown',
      error: '请在终端核查',
      result: { handle: 'handle', excerpt: '原始摘要片段', truncated: true },
    },
  ])
  expect(host.querySelector('.ai-tool-records > summary [data-attention=true]')?.textContent).toBe('结果未知')
  expect(host.querySelector('[aria-label="输出摘要代码块"]')?.textContent).toContain('原始摘要片段')
  expect(host.textContent).toContain('输出已截断')
  expect(host.textContent).toContain('请在终端核查')
  expect(host.textContent).not.toContain('重新执行')
})
