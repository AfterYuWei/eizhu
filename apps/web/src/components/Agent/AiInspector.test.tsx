// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { AiConversation, AiToolCall } from '@eizhu/contracts'
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
    remove: vi.fn(),
    read: vi.fn(),
    cliStatus: vi.fn(),
    capabilities: vi.fn(),
    backend: vi.fn(),
    permission: vi.fn(),
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
  api.ai.history.mockResolvedValue([
    { id: c.id, title: c.title, updatedAt: c.updatedAt, backend: c.backend },
    { id: 'other-chat', title: '旧对话', updatedAt: 1, backend: c.backend },
  ])
  api.ai.remove.mockResolvedValue(undefined)
  api.ai.scope.mockImplementation(
    async ({ conversationId, sessionIds }: { conversationId: string; sessionIds: string[] }) => ({
      ...useAiStore.getState().conversations[conversationId],
      targets: sessionIds.map((sessionId) => ({ ...c.targets[0], sessionId })),
      revision: useAiStore.getState().conversations[conversationId].revision + 1,
      status: 'idle',
      messages: c.messages.filter((m) => !m.tool),
    }),
  )
  api.ai.permission.mockImplementation(async ({ permission }) => ({
    ...useAiStore.getState().conversations.chat,
    permission,
  }))
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
async function pending(overrides: Partial<AiToolCall> = {}) {
  const args = {
    sessionId: 'a',
    command: 'printf hello',
    cwd: '/tmp',
    purpose: '检查终端',
    impact: '只读查询',
    timeoutSeconds: 60,
  }
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
            args,
            sessionId: 'a',
            state: 'pending',
            preview: JSON.stringify(args, null, 2),
            error: '',
            ...overrides,
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
  const approval = host.querySelector('.ai-composer .ai-approval')!
  expect(approval.querySelector('pre')!.textContent).toBe('printf hello')
  expect(approval.textContent).not.toMatch(/terminal_execute|sessionId|timeoutSeconds|只读查询/)
  expect(approval.querySelector('.ai-command-target')!.textContent).toContain('test@a.invalid:22 · /tmp')
  await act(async () =>
    host.querySelector<HTMLButtonElement>('.ai-approval [aria-label="复制命令"]')!.click(),
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
it('long task approval copies the exact multiline Unicode command instead of the parameter preview', async () => {
  const command = 'printf "%s\\n" "你好，🌙"\nls -- "项目目录"\n'
  await pending({ name: 'terminal_start', args: { sessionId: 'a', command, cwd: '/tmp/项目' } })
  const approval = host.querySelector('.ai-approval')!
  const lines = [...approval.querySelectorAll('.ai-code-line > span:last-child')].map((line) => line.textContent)
  expect(lines.join('\n')).toBe(command.slice(0, -1))
  await act(async () => approval.querySelector<HTMLButtonElement>('[aria-label="复制命令"]')!.click())
  expect(api.clipboard.write).toHaveBeenCalledWith({ text: command })
  expect(api.ai.decide).not.toHaveBeenCalled()
})
it('file approval retains the path and prepared diff instead of rendering file contents as a shell command', async () => {
  const preview = '文件：/etc/app.conf\n--- 修改前\nport=80\n+++ 修改后\nport=8080'
  await pending({
    name: 'file_edit',
    args: { sessionId: 'a', path: '/etc/app.conf', oldText: 'port=80', newText: 'port=8080' },
    preview,
  })
  const approval = host.querySelector('.ai-approval')!
  expect(approval.textContent).toContain('允许此操作？')
  expect(approval.textContent).toContain('/etc/app.conf')
  expect(approval.textContent).toContain('port=80')
  expect(approval.textContent).toContain('port=8080')
  await act(async () => approval.querySelector<HTMLButtonElement>('[aria-label="复制操作预览"]')!.click())
  expect(api.clipboard.write).toHaveBeenCalledWith({ text: preview })
  expect(api.ai.decide).not.toHaveBeenCalled()
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
it('scope stays hidden and automatically follows all connected SSH sessions', async () => {
  expect(host.querySelector('.ai-scope-summary')).toBeNull()
  expect(host.textContent).not.toContain('连接范围')
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
  expect(host.textContent).not.toContain('连接范围')
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
  expect(host.textContent).not.toContain('连接范围')
  await fill('不能执行')
  expect(button('发送').disabled).toBe(true)
})
it('permission control is inside the input card and explains all three remote modes', async () => {
  const control = host.querySelector<HTMLButtonElement>('#ai-permission-picker')!
  expect(host.querySelector('.ai-composer #ai-permission-picker')).toBe(control)
  expect(host.querySelector('.ai-session-controls #ai-permission-picker')).toBeNull()
  expect(control.getAttribute('aria-label')).toBe('执行模式：执行前确认')
  await act(async () => control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  const options = [...document.querySelectorAll<HTMLElement>('[role=menuitemradio]')]
  expect(options).toHaveLength(3)
  expect(options[1].getAttribute('aria-checked')).toBe('true')
  expect(options[0].textContent).toContain('不执行命令或修改文件')
  expect(options[2].textContent).toContain('当前SSH会话范围内')
  await act(async () => options[2].click())
  expect(api.ai.permission).toHaveBeenCalledWith({ conversationId: 'chat', permission: 'auto' })
  expect(control.getAttribute('aria-label')).toBe('执行模式：自动执行')
})
it('supplier icon follows the provider and available native CLI instead of a robot', async () => {
  await act(async () =>
    useAiStore.getState().setSettings({
      ...useAiStore.getState().settings!,
      providers: [
        {
          ...useAiStore.getState().settings!.providers[0],
          name: 'DeepSeek',
          endpoint: 'https://api.deepseek.com',
        },
      ],
    }),
  )
  await choose('ai-agent-picker', 'DeepSeek')
  expect(host.querySelector('#ai-agent-picker [data-ai-brand=deepseek]')).not.toBeNull()
  expect(host.querySelector('#ai-agent-picker .lucide-bot')).toBeNull()
  await choose('ai-agent-picker', 'Codex')
  expect(host.querySelector('#ai-agent-picker [data-ai-brand=codex]')).not.toBeNull()
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
  expect(host.querySelector<HTMLButtonElement>('[id="ai-agent-picker"]')!.disabled).toBe(true)
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

async function openHistory() {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="对话历史"]')!.click())
}
const historyButton = (label: string) =>
  document.querySelector<HTMLButtonElement>('.ai-history-dialog [aria-label="' + label + '"]')!
it('history is a dialog; opening a chat closes it and preserves the current draft', async () => {
  await fill('保留未发送内容')
  expect(host.querySelector('.ai-history-dialog')).toBeNull()
  expect(host.textContent).not.toContain('删除对话')
  await openHistory()
  expect(document.querySelector('[role=dialog]')!.textContent).toContain('对话历史')
  expect(host.querySelector('.ai-history-delete')).toBeNull()
  expect(document.querySelectorAll('.ai-history-dialog .ai-history-delete')).toHaveLength(2)
  await act(async () => historyButton('打开对话：检查').click())
  expect(api.ai.read).toHaveBeenCalledWith({ conversationId: 'chat' })
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(host.querySelector('textarea')!.value).toBe('保留未发送内容')
})
it('deleting another chat is restricted to history and preserves the current chat and draft', async () => {
  await fill('当前草稿')
  await openHistory()
  await act(async () => historyButton('删除对话：旧对话').click())
  expect(api.ai.remove).toHaveBeenCalledWith({ conversationId: 'other-chat' })
  expect(document.querySelector('.ai-history-dialog [aria-label="删除对话：旧对话"]')).toBeNull()
  expect(useAiStore.getState().selectedId).toBe('chat')
  await act(async () => historyButton('关闭对话历史').click())
  expect(host.querySelector('textarea')!.value).toBe('当前草稿')
  expect(host.querySelector('.ai-history-delete')).toBeNull()
})
it('deleting the current chat clears its selection and leaves history open', async () => {
  await fill('待删除的草稿')
  await openHistory()
  await act(async () => historyButton('删除对话：检查').click())
  expect(api.ai.remove).toHaveBeenCalledWith({ conversationId: 'chat' })
  expect(useAiStore.getState().selectedId).toBeNull()
  expect(useAiStore.getState().conversations.chat).toBeUndefined()
  expect(document.querySelector('[role=dialog]')).not.toBeNull()
  expect(document.querySelector('.ai-history-dialog [aria-label="删除对话：检查"]')).toBeNull()
  await act(async () => historyButton('关闭对话历史').click())
  expect(host.querySelector('textarea')!.value).toBe('')
})
it('failed history deletion retains the row and shows the error inside the dialog', async () => {
  api.ai.remove.mockRejectedValue(new Error('删除失败'))
  await openHistory()
  await act(async () => historyButton('删除对话：检查').click())
  expect(document.querySelector('.ai-history-dialog [role=alert]')!.textContent).toBe('删除失败')
  expect(historyButton('删除对话：检查')).not.toBeNull()
  expect(useAiStore.getState().selectedId).toBe('chat')
  expect(host.querySelector('[role=alert]')).toBeNull()
})
it('history read failures do not report a false empty history', async () => {
  api.ai.history.mockRejectedValue(new Error('无法读取历史'))
  await openHistory()
  expect(document.querySelector('.ai-history-dialog [role=alert]')!.textContent).toBe('无法读取历史')
  expect(document.querySelector('.ai-history-empty')).toBeNull()
})
it('closing history while loading cannot reopen it when the response arrives', async () => {
  let finish!: (rows: unknown[]) => void
  api.ai.history.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await openHistory()
  await act(async () => historyButton('关闭对话历史').click())
  await act(async () => finish([]))
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(useAiStore.getState().selectedId).toBe('chat')
})
it('history delete dispatches only once while its request is pending', async () => {
  let finish!: () => void
  api.ai.remove.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve
    }),
  )
  await openHistory()
  const remove = historyButton('删除对话：旧对话')
  await act(async () => remove.click())
  expect(remove.disabled).toBe(true)
  await act(async () => remove.click())
  expect(api.ai.remove).toHaveBeenCalledTimes(1)
  await act(async () => finish())
})

async function choosePermission(value: string) {
  await act(async () =>
    document
      .getElementById('ai-permission-picker')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  )
  await act(async () =>
    document.querySelector<HTMLElement>('.ai-permission-menu [data-permission="' + value + '"]')!.click(),
  )
}
for (const permission of ['observer', 'auto'] as const)
  it(
    'new chat can select ' + permission + ' before its first message and applies it before sending',
    async () => {
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="新建AI对话"]')!.click())
      expect(host.querySelector<HTMLButtonElement>('#ai-permission-picker')!.disabled).toBe(false)
      await choosePermission(permission)
      expect(api.ai.open).not.toHaveBeenCalled()
      expect(api.ai.permission).not.toHaveBeenCalled()
      const created = { ...c, id: 'first-chat' }
      api.ai.open.mockResolvedValue(created)
      api.ai.permission.mockResolvedValue({ ...created, permission })
      await fill('首条消息使用选定模式')
      await act(async () => button('发送').click())
      expect(api.ai.permission).toHaveBeenCalledWith({ conversationId: 'first-chat', permission })
      expect(api.ai.permission.mock.invocationCallOrder[0]).toBeLessThan(
        api.ai.send.mock.invocationCallOrder[0],
      )
      expect(useAiStore.getState().conversations['first-chat'].permission).toBe(permission)
      expect(api.ai.send).toHaveBeenCalledWith({
        conversationId: 'first-chat',
        text: '首条消息使用选定模式',
        attachments: [],
      })
    },
  )
it('starting another new chat resets its mode to confirmation', async () => {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="新建AI对话"]')!.click())
  await choosePermission('auto')
  expect(host.querySelector('#ai-permission-picker')!.getAttribute('data-permission')).toBe('auto')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="新建AI对话"]')!.click())
  expect(host.querySelector('#ai-permission-picker')!.getAttribute('data-permission')).toBe('confirm')
})
it('failed initial permission application sends nothing and preserves the new draft and chosen mode', async () => {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="新建AI对话"]')!.click())
  await choosePermission('auto')
  api.ai.open.mockResolvedValue({ ...c, id: 'first-chat' })
  api.ai.permission.mockRejectedValue(new Error('设置执行模式失败'))
  await fill('不得在模式未确认时运行')
  await act(async () => button('发送').click())
  expect(api.ai.send).not.toHaveBeenCalled()
  expect(useAiStore.getState().selectedId).toBeNull()
  expect(host.querySelector('textarea')!.value).toBe('不得在模式未确认时运行')
  expect(host.querySelector('#ai-permission-picker')!.getAttribute('data-permission')).toBe('auto')
  expect(host.querySelector('[role=alert]')!.textContent).toBe('设置执行模式失败')
})
it('a failed first send retains the draft in the conversation that was created', async () => {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="新建AI对话"]')!.click())
  api.ai.open.mockResolvedValue({ ...c, id: 'first-chat' })
  api.ai.send.mockRejectedValue(new Error('发送失败'))
  await fill('保留这条消息')
  await act(async () => button('发送').click())
  expect(useAiStore.getState().selectedId).toBe('first-chat')
  expect(host.querySelector('textarea')!.value).toBe('保留这条消息')
})
