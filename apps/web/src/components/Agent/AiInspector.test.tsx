// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { AiConversation } from '@eizhu/contracts'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAiStore } from '@/store/ai'
import { useSessionStore } from '@/store/session'
import { AiInspector } from './AiInspector'
const api = vi.hoisted(() => ({
  ai: {
    settings: vi.fn(),
    decide: vi.fn(),
    open: vi.fn(),
    send: vi.fn(),
    scope: vi.fn(),
    cancel: vi.fn(),
    stopJob: vi.fn(),
    history: vi.fn(),
  },
  events: { on: vi.fn(() => () => {}) },
  clipboard: { write: vi.fn() },
}))
vi.mock('@/lib/bridge', () => ({ bridge: () => api }))
let host: HTMLDivElement, root: Root, c: AiConversation
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!
beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  vi.stubGlobal('eizhu', api)
  api.ai.settings.mockResolvedValue({
    enabled: true,
    providers: [],
    clis: [],
    defaultBackend: { kind: 'official', model: '' },
  })
  api.ai.decide.mockResolvedValue(undefined)
  api.clipboard.write.mockResolvedValue(undefined)
  c = {
    id: 'chat',
    title: '检查',
    updatedAt: 0,
    backend: { kind: 'official', model: '' },
    permission: 'confirm',
    revision: 4,
    targets: [
      {
        sessionId: 'a',
        profileId: 'p',
        host: 'a.invalid',
        username: 'test',
        port: 22,
        cwd: '/tmp',
        system: 'Linux',
      },
    ],
    messages: [{ id: 'u', role: 'user', text: '检查' }],
    jobs: [],
    summary: '',
    status: 'idle',
    error: '',
  }
  useAiStore.setState(
    { ...useAiStore.getInitialState(), selectedId: c.id, conversations: { [c.id]: c } },
    true,
  )
  useSessionStore.setState(
    {
      ...useSessionStore.getInitialState(),
      activeTabId: 'tab-a',
      tabs: [
        { id: 'tab-a', sessionId: 'a', profileId: 'p', profileName: '主机A', status: 'connected' },
        { id: 'tab-b', sessionId: 'b', profileId: 'q', profileName: '主机B', status: 'connected' },
      ],
    },
    true,
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root.render(
      <TooltipProvider>
        <AiInspector open overlay={false} onClose={() => {}} onChoose={() => {}} />
      </TooltipProvider>,
    ),
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
async function pending() {
  await act(async () => {
    c = {
      ...c,
      status: 'awaiting_confirmation',
      messages: [
        ...c.messages,
        {
          id: 'tool',
          role: 'tool',
          text: '',
          tool: {
            id: 'call',
            name: 'terminal_execute',
            args: { sessionId: 'a' },
            sessionId: 'a',
            state: 'pending',
            preview: 'printf hello',
            error: '',
          },
        },
      ],
    }
    useAiStore.getState().put(c)
  })
}
it('changing terminal tab preserves the independent conversation and never opens another chat', async () => {
  await act(async () => useSessionStore.setState({ activeTabId: 'tab-b' }))
  expect(useAiStore.getState().selectedId).toBe('chat')
  expect(api.ai.open).not.toHaveBeenCalled()
  expect(host.textContent).toContain('检查')
})
it('approval is fixed at the bottom; copy cannot execute; decision includes revision and scope', async () => {
  await pending()
  expect(host.querySelector('.ai-messages .ai-approval')).toBeNull()
  expect(host.querySelector('.ai-composer .ai-approval')).not.toBeNull()
  await act(async () =>
    host.querySelector<HTMLButtonElement>('.ai-approval [aria-label="复制操作预览"]')!.click(),
  )
  expect(api.clipboard.write).toHaveBeenCalledWith({ text: 'printf hello' })
  expect(api.ai.decide).not.toHaveBeenCalled()
  await act(async () => button('对话内允许此工具').click())
  expect(api.ai.decide).toHaveBeenCalledWith({
    conversationId: 'chat',
    callId: 'call',
    decision: 'conversation',
    revision: 4,
  })
})
it('disconnected target disables approval even when a different terminal is connected', async () => {
  await pending()
  await act(async () =>
    useSessionStore.setState((s) => ({
      tabs: s.tabs.map((t) => (t.sessionId === 'a' ? { ...t, status: 'disconnected' } : t)),
    })),
  )
  expect(button('允许本次').disabled).toBe(true)
  expect(button('对话内允许此工具').disabled).toBe(true)
})
it('approval failures remain visible and do not silently grant access', async () => {
  api.ai.decide.mockRejectedValue(new Error('审批已失效'))
  await pending()
  await act(async () => button('允许本次').click())
  expect(host.querySelector('.ai-approval')).not.toBeNull()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('审批已失效')
})
it('connection scope applies an explicit selected set instead of following the active tab', async () => {
  api.ai.scope.mockResolvedValue(c)
  await act(async () => button('连接范围 · 1').click())
  const boxes = host.querySelectorAll<HTMLInputElement>('.ai-scope input')
  await act(async () => boxes[1].click())
  await act(async () => button('应用连接范围').click())
  expect(api.ai.scope).toHaveBeenCalledWith({ conversationId: 'chat', sessionIds: ['a', 'b'] })
})

it('idle Agent retains independent and all-task stop controls for running jobs', async () => {
  await act(async () => {
    c = {
      ...c,
      status: 'idle',
      jobs: [{ id: 'job1', sessionId: 'a', command: 'sleep 30', status: 'running' }],
    }
    useAiStore.getState().put(c)
  })
  api.ai.stopJob.mockResolvedValue({ ...c, jobs: [] })
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="停止任务 job1"]')!.click())
  expect(api.ai.stopJob).toHaveBeenCalledWith({ conversationId: 'chat', jobId: 'job1' })
})

it('shows the configured Agent without an engine picker and blocks sending when disabled', async () => {
  await act(async () =>
    useAiStore
      .getState()
      .setSettings({ enabled: false, providers: [], clis: [], defaultBackend: { kind: 'codex', model: '' } }),
  )
  expect(host.querySelector('[aria-label="选择Agent与模型"]')).toBeNull()
  expect(host.textContent).toContain('AI助手未启用')
  expect(button('发送').disabled).toBe(true)
})
