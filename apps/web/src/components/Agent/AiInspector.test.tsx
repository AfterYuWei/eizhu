// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { AiConversation } from '@eizhu/contracts'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAiStore } from '@/store/ai'
import { useAccountStore } from '@/store/account'
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
    read: vi.fn(),
    cliStatus: vi.fn(),
    capabilities: vi.fn(),
    backend: vi.fn(),
  },
  document: { pick: vi.fn(), readText: vi.fn(), release: vi.fn() },
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  HTMLElement.prototype.scrollIntoView = vi.fn()
  useAccountStore.setState({
    status: {
      loggedIn: true,
      sessionState: 'authenticated',
      syncEnabled: false,
      user: {
        id: 1,
        email: 'fixture@example.invalid',
        emailVerified: true,
        verificationRequired: false,
        storageUsed: 0,
        storageQuota: 0,
      },
    },
  })
  api.ai.cliStatus.mockResolvedValue([
    { kind: 'codex', path: '/fixture/codex', available: true, message: 'fixture' },
    { kind: 'claude', path: '', available: false, message: '未安装' },
  ])
  api.ai.capabilities.mockResolvedValue({
    available: true,
    models: [{ id: 'official-model', name: '官方模型' }],
    defaultModel: 'official-model',
  })
  api.document.release.mockResolvedValue(undefined)
  api.ai.backend.mockImplementation(async ({ backend }) => ({
    ...useAiStore.getState().conversations.chat,
    backend,
    status: 'idle',
    messages: c.messages.filter((m) => !m.tool),
  }))
  api.ai.send.mockResolvedValue(undefined)
  api.ai.settings.mockResolvedValue({
    enabled: true,
    providers: [
      {
        id: 'p',
        name: '测试供应商',
        protocol: 'responses',
        endpoint: 'https://fixture.invalid',
        model: 'model-a',
        models: [
          { id: 'model-a', name: '模型A' },
          { id: 'model-b', name: '模型B' },
        ],
        contextWindow: 256000,
        hasApiKey: true,
      },
    ],
    clis: [],
    defaultBackend: { kind: 'official', model: 'official-model' },
  })
  api.ai.decide.mockResolvedValue(undefined)
  api.clipboard.write.mockResolvedValue(undefined)
  c = {
    id: 'chat',
    title: '检查',
    updatedAt: 0,
    backend: { kind: 'official', model: 'official-model' },
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
      {
        sessionId: 'b',
        profileId: 'q',
        host: 'b.invalid',
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
  api.ai.scope.mockImplementation(
    async ({ conversationId, sessionIds }: { conversationId: string; sessionIds: string[] }) => ({
      ...useAiStore.getState().conversations[conversationId],
      targets: sessionIds.map((sessionId) => ({ ...c.targets[0], sessionId })),
      revision: useAiStore.getState().conversations[conversationId].revision + 1,
      status: 'idle',
      messages: c.messages.filter((m) => !m.tool),
    }),
  )
  api.ai.cancel.mockResolvedValue(undefined)
  api.ai.read.mockImplementation(async ({ conversationId }: { conversationId: string }) => ({
    ...useAiStore.getState().conversations[conversationId],
    status: 'idle',
    messages: c.messages.filter((m) => !m.tool),
  }))
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
it('scope changes disable old approvals before automatic synchronization finishes', async () => {
  let finish!: (value: AiConversation) => void
  api.ai.scope.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await pending()
  await act(async () =>
    useSessionStore.setState((s) => ({ tabs: s.tabs.filter((t) => t.sessionId !== 'a') })),
  )
  expect(button('允许本次').disabled).toBe(true)
  expect(button('对话内允许此工具').disabled).toBe(true)
  expect(api.ai.scope).toHaveBeenCalledWith({ conversationId: 'chat', sessionIds: ['b'] })
  await act(async () => finish({ ...c, targets: [c.targets[1]], messages: [], status: 'idle' }))
})
it('approval failures remain visible and do not silently grant access', async () => {
  api.ai.decide.mockRejectedValue(new Error('审批已失效'))
  await pending()
  await act(async () => button('允许本次').click())
  expect(host.querySelector('.ai-approval')).not.toBeNull()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('审批已失效')
})
it('scope is read-only and automatically follows all connected SSH sessions', async () => {
  expect(host.querySelector('.ai-scope-summary')!.textContent).toBe('连接范围 · 2')
  expect(host.querySelector('.ai-scope')).toBeNull()
  expect(host.querySelector('.ai-session-controls [type=checkbox]')).toBeNull()
  expect(button('应用连接范围')).toBeUndefined()
  await act(async () =>
    useSessionStore.setState((s) => ({
      tabs: [
        ...s.tabs,
        { id: 'tab-c', sessionId: 'c', profileId: 'r', profileName: '主机C', status: 'connected' },
      ],
    })),
  )
  expect(api.ai.scope).toHaveBeenCalledWith({ conversationId: 'chat', sessionIds: ['a', 'b', 'c'] })
  expect(host.querySelector('.ai-scope-summary')!.textContent).toBe('连接范围 · 3')
  api.ai.scope.mockClear()
  await act(async () => useSessionStore.setState({ activeTabId: 'tab-b' }))
  expect(api.ai.scope).not.toHaveBeenCalled()
  await act(async () =>
    useSessionStore.setState((s) => ({ tabs: s.tabs.filter((t) => t.sessionId !== 'c') })),
  )
  expect(api.ai.scope).toHaveBeenCalledWith({ conversationId: 'chat', sessionIds: ['a', 'b'] })
})
it('closing all SSH sessions stops the Agent and blocks sending', async () => {
  await act(async () => useSessionStore.setState({ tabs: [], activeTabId: null }))
  expect(api.ai.cancel).toHaveBeenCalledWith({ conversationId: 'chat' })
  expect(api.ai.scope).not.toHaveBeenCalled()
  expect(host.querySelector('.ai-scope-summary')!.textContent).toBe('连接范围 · 0')
  await fill('不能执行')
  expect(button('发送').disabled).toBe(true)
})
it('execution modes explain confirmation instead of using an ambiguous label', async () => {
  const control = host.querySelector('[aria-label="执行模式"]')!
  expect(control.textContent).toBe('执行前确认')
  expect(control.getAttribute('title')).toContain('执行shell命令或修改文件前')
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

it('blocks sending and Agent selection when AI is disabled', async () => {
  await act(async () =>
    useAiStore
      .getState()
      .setSettings({ enabled: false, providers: [], clis: [], defaultBackend: { kind: 'codex', model: '' } }),
  )
  expect(host.querySelector<HTMLButtonElement>('[aria-label="选择Agent"]')!.disabled).toBe(true)
  expect(host.textContent).toContain('启用AI助手')
  expect(button('发送').disabled).toBe(true)
})

async function choose(id: string, label: string) {
  await act(async () => document.getElementById(id)!.click())
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role=option]')]
      .find((e) => e.textContent === label)!
      .click(),
  )
}
async function fill(text: string) {
  await act(async () => {
    const input = host.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function attach() {
  await act(async () =>
    host
      .querySelector('[aria-label="添加附件"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  )
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role=menuitem]')]
      .find((e) => e.textContent === '上传附件')!
      .click(),
  )
}
it('composer offers saved suppliers and installed compatible CLIs without the old backend band', async () => {
  expect(host.querySelector('.ai-backend-current')).toBeNull()
  expect(host.textContent).not.toContain('附加选区')
  expect(host.textContent).not.toContain('附加文件')
  await act(async () => document.getElementById('ai-agent-picker')!.click())
  const labels = [...document.querySelectorAll('[role=option]')].map((e) => e.textContent)
  expect(labels).toEqual(['官方AI', '测试供应商', 'Codex'])
  expect(labels).not.toContain('Claude Code')
})
it('Agent and candidate model switches apply to this chat and preserve its draft and scope', async () => {
  await fill('保留草稿')
  await pending()
  await choose('ai-agent-picker', '测试供应商')
  expect(api.ai.backend).toHaveBeenLastCalledWith({
    conversationId: 'chat',
    backend: { kind: 'custom', providerId: 'p', model: 'model-a' },
  })
  expect(host.querySelector('textarea')!.value).toBe('保留草稿')
  await choose('ai-chat-model', '模型B')
  expect(api.ai.backend).toHaveBeenLastCalledWith({
    conversationId: 'chat',
    backend: { kind: 'custom', providerId: 'p', model: 'model-b' },
  })
  expect(useAiStore.getState().conversations.chat.targets[0].sessionId).toBe('a')
  expect(useAiStore.getState().settings!.defaultBackend.kind).toBe('official')
  expect(host.querySelector('textarea')!.value).toBe('保留草稿')
})
it('new chat sends with its chosen supplier and model', async () => {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="新建AI对话"]')!.click())
  await choose('ai-agent-picker', '测试供应商')
  await choose('ai-chat-model', '模型B')
  api.ai.open.mockResolvedValue({
    ...c,
    id: 'new-chat',
    backend: { kind: 'custom', providerId: 'p', model: 'model-b' },
  })
  await fill('新任务')
  await act(async () => button('发送').click())
  expect(api.ai.open).toHaveBeenCalledWith({
    sessionIds: ['a', 'b'],
    backend: { kind: 'custom', providerId: 'p', model: 'model-b' },
  })
  expect(api.ai.send).toHaveBeenCalledWith({ conversationId: 'new-chat', text: '新任务', attachments: [] })
})
it('unavailable restored CLI remains unselected and cannot send', async () => {
  await act(async () => useAiStore.getState().put({ ...c, backend: { kind: 'claude', model: '' } }))
  await fill('不得调用')
  expect(document.getElementById('ai-agent-picker')!.textContent).toContain('Agent')
  expect(button('发送').disabled).toBe(true)
  await act(async () => button('发送').click())
  expect(api.ai.send).not.toHaveBeenCalled()
})
it('plus menu uploads text attachments, releases references and allows removal', async () => {
  api.document.pick.mockResolvedValue([{ name: '日志.txt', reference: 'doc1' }])
  api.document.readText.mockResolvedValue('hello')
  await attach()
  expect(api.document.readText).toHaveBeenCalledWith({ reference: 'doc1', maxBytes: 65536 })
  expect(api.document.release).toHaveBeenCalledWith({ reference: 'doc1' })
  expect(host.querySelector('[aria-label="移除附件 日志.txt"]')).not.toBeNull()
  await fill('分析日志')
  await choose('ai-agent-picker', '测试供应商')
  await act(async () => button('发送').click())
  expect(api.ai.send).toHaveBeenCalledWith({
    conversationId: 'chat',
    text: '分析日志',
    attachments: [{ name: '日志.txt', content: 'hello' }],
  })
  api.document.pick.mockResolvedValue([{ name: '另一个.txt', reference: 'doc2' }])
  await attach()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除附件 另一个.txt"]')!.click())
  expect(host.querySelector('.ai-attachment-chip')).toBeNull()
})
it('failed attachment reads release all selected references without partially attaching', async () => {
  api.document.pick.mockResolvedValue([
    { name: 'one', reference: 'doc1' },
    { name: 'two', reference: 'doc2' },
  ])
  api.document.readText.mockRejectedValue(new Error('无法读取文件'))
  await attach()
  expect(api.document.release).toHaveBeenCalledTimes(2)
  expect(host.querySelector('.ai-attachment-chip')).toBeNull()
  expect(host.querySelector('[role=alert]')!.textContent).toBe('无法读取文件')
})

it('rapid session changes synchronize in order and finish with the latest open set', async () => {
  const scope = api.ai.scope.getMockImplementation()!
  let finish!: (value: AiConversation) => void
  api.ai.scope.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await act(async () =>
    useSessionStore.setState((s) => ({ tabs: s.tabs.filter((t) => t.sessionId === 'a') })),
  )
  expect(api.ai.scope).toHaveBeenCalledTimes(1)
  await act(async () =>
    useSessionStore.setState((s) => ({
      tabs: [
        ...s.tabs,
        { id: 'tab-c', sessionId: 'c', profileId: 'r', profileName: '主机C', status: 'connected' },
      ],
    })),
  )
  expect(api.ai.scope).toHaveBeenCalledTimes(1)
  await act(async () => finish(await scope({ conversationId: 'chat', sessionIds: ['a'] })))
  expect(api.ai.scope).toHaveBeenLastCalledWith({ conversationId: 'chat', sessionIds: ['a', 'c'] })
  expect(useAiStore.getState().conversations.chat.targets.map((t) => t.sessionId)).toEqual(['a', 'c'])
})
it('connection status changes and reconnect replace the range without including connecting tabs', async () => {
  await act(async () =>
    useSessionStore.setState((s) => ({
      tabs: s.tabs.map((t) => (t.sessionId === 'a' ? { ...t, status: 'reconnecting' } : t)),
    })),
  )
  expect(api.ai.scope).toHaveBeenLastCalledWith({ conversationId: 'chat', sessionIds: ['b'] })
  await act(async () =>
    useSessionStore.setState((s) => ({
      tabs: s.tabs.map((t) => (t.id === 'tab-a' ? { ...t, sessionId: 'a-new', status: 'connected' } : t)),
    })),
  )
  expect(api.ai.scope).toHaveBeenLastCalledWith({ conversationId: 'chat', sessionIds: ['a-new', 'b'] })
})
