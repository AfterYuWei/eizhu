// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { DesktopError, type AiConversation, type AiToolCall } from '@eizhu/contracts'
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
    async ({ conversationId, sessionIds }: { conversationId: string; sessionIds: string[] }) => {
      const current = useAiStore.getState().conversations[conversationId]
      if (
        JSON.stringify(current.targets.map((target) => target.sessionId).sort()) ===
        JSON.stringify([...sessionIds].sort())
      )
        return current
      return {
        ...current,
        targets: sessionIds.map(
          (sessionId) =>
            current.targets.find((target) => target.sessionId === sessionId) ??
            c.targets.find((target) => target.sessionId === sessionId) ?? { ...c.targets[0], sessionId },
        ),
        revision: current.revision + 1,
        status: 'idle',
        messages: current.messages.filter((m) => !m.tool),
      }
    },
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
  api.ai.scope.mockClear()
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
it('keeps text and multiple commands in one reply and copies the complete reply once', async () => {
  const firstText = { id: 'a1', role: 'assistant' as const, text: '我来查看近期日志。' }
  const tool = (id: string, sessionId: string): AiConversation['messages'][number] => ({
    id,
    role: 'tool',
    text: '',
    tool: {
      id,
      sessionId,
      name: 'terminal_execute',
      args: {},
      state: 'completed',
      preview: 'docker logs gitlab',
      result: '日志内容',
      error: '',
    },
  })
  await act(async () => {
    c = { ...c, status: 'thinking', messages: [...c.messages, firstText, tool('t1', 'a')] }
    useAiStore.getState().put(c)
  })
  const reply = host.querySelector('.ai-message.is-assistant')!
  const command = reply.querySelector('details')!
  await act(async () => {
    command.open = true
  })
  expect(reply.querySelector('[aria-label="复制回复"]')).toBeNull()
  await act(async () => {
    c = {
      ...c,
      status: 'idle',
      messages: [...c.messages, tool('t2', 'b'), { id: 'a2', role: 'assistant', text: '服务运行正常。' }],
    }
    useAiStore.getState().put(c)
  })
  expect(host.querySelectorAll('.ai-message.is-assistant')).toHaveLength(1)
  expect(host.querySelectorAll('[aria-label="AI头像"]')).toHaveLength(1)
  expect(host.querySelector('.ai-message.is-assistant')).toBe(reply)
  expect(reply.querySelector('details')).toBe(command)
  expect(command.open).toBe(true)
  expect(
    [...reply.querySelectorAll('.ai-message-part')].map(
      (part) => part.querySelector('.ai-markdown')?.textContent ?? part.querySelector('summary')?.textContent,
    ),
  ).toEqual(['我来查看近期日志。', '执行记录（2 项）已完成', '服务运行正常。'])
  expect([...reply.querySelectorAll('.ai-command-target')].map((target) => target.textContent)).toEqual([
    'test@a.invalid:22',
    'test@b.invalid:22',
  ])
  const copies = host.querySelectorAll<HTMLButtonElement>('[aria-label="复制回复"]')
  expect(copies).toHaveLength(1)
  await act(async () => copies[0].click())
  expect(api.clipboard.write).toHaveBeenCalledWith({ text: '我来查看近期日志。\n\n服务运行正常。' })

  await act(async () =>
    useAiStore.getState().put({
      ...c,
      messages: [
        ...c.messages,
        { id: 'u2', role: 'user', text: '再检查内存' },
        { id: 'a3', role: 'assistant', text: '内存正常。' },
      ],
    }),
  )
  expect(host.querySelectorAll('.ai-message.is-assistant')).toHaveLength(2)
  expect(host.querySelectorAll('[aria-label="复制回复"]')).toHaveLength(2)
})
it('shows persistent activity before the first token, during tools and while replying, with a working stop action', async () => {
  c = { ...c, messages: [{ ...c.messages[0], startedAt: Date.now() - 2000 }] }
  await act(async () => useAiStore.getState().put({ ...c, status: 'thinking' }))
  const reply = host.querySelector('.ai-message.is-assistant')!
  expect(reply.querySelector('.ai-message-role time')?.textContent).toMatch(/^已处理 /)
  expect(reply.querySelector('.ai-markdown')).toBeNull()
  const status = host.querySelector('.ai-response-status')!
  expect(status.getAttribute('role')).toBe('status')
  expect(status.textContent).toContain('正在思考')
  expect(status.querySelector('svg')).not.toBeNull()
  expect(host.querySelector('.ai-messages .ai-response-status')).toBeNull()
  expect(host.querySelector('[aria-label="停止Agent"]')).not.toBeNull()

  await pending({ state: 'running' })
  await act(async () => useAiStore.getState().put({ ...c, status: 'executing' }))
  expect(status.textContent).toContain('正在执行操作')
  await act(async () => {
    c = { ...c, status: 'thinking', messages: [...c.messages, { id: 'answer', role: 'assistant', text: '' }] }
    useAiStore.getState().put(c)
  })
  expect(status.textContent).toContain('正在思考')
  await act(async () =>
    useAiStore.getState().progress(c.id, { id: 'answer', role: 'assistant', text: '检查结论' }),
  )
  expect(status.textContent).toContain('正在回复')
  expect(host.querySelector('.ai-message.is-assistant')).toBe(reply)
  expect(host.querySelector('.ai-message.is-assistant')?.getAttribute('aria-busy')).toBe('true')

  api.ai.cancel.mockImplementationOnce(async () => {
    useAiStore.getState().put({ ...useAiStore.getState().conversations.chat, status: 'paused' })
  })
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="停止Agent"]')!.click())
  expect(api.ai.cancel).toHaveBeenCalledWith({ conversationId: c.id })
  expect(host.querySelector('.ai-response-status')).toBeNull()
  expect(document.querySelector('.ai-error-dialog')).toBeNull()
  expect(host.querySelector('.ai-message.is-assistant')?.getAttribute('aria-busy')).toBe('false')
})
it.each(['idle', 'paused', 'error'] as const)(
  'clears the activity indicator when the Agent becomes %s',
  async (status) => {
    await pending()
    expect(host.querySelector('.ai-response-status')?.textContent).toBe('等待你确认')
    expect(host.querySelector('.ai-response-status .motion-safe\\:animate-spin')).toBeNull()
    await act(async () =>
      useAiStore.getState().put({ ...c, status, error: status === 'error' ? '连接失败' : '' }),
    )
    expect(host.querySelector('.ai-response-status')).toBeNull()
    expect(host.querySelector('[aria-label="停止Agent"]')).toBeNull()
    expect(host.querySelector('.ai-error,[role="alert"]')).toBeNull()
    if (status === 'error')
      expect(document.querySelector('.ai-error-dialog [data-slot="dialog-description"]')?.textContent).toBe(
        '连接失败',
      )
  },
)
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
  const lines = [...approval.querySelectorAll('.ai-code-line > span:last-child')].map(
    (line) => line.textContent,
  )
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
  expect(document.querySelector('.ai-error-dialog [data-slot="dialog-description"]')?.textContent).toBe(
    '审批已失效',
  )
  expect(host.querySelector('[role="alert"]')).toBeNull()
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
  expect(api.ai.scope).toHaveBeenCalledWith({ conversationId: 'chat', sessionIds: [] })
  expect(api.ai.cancel).not.toHaveBeenCalled()
  expect(useAiStore.getState().conversations.chat.targets).toEqual([])
  expect(host.textContent).not.toContain('连接范围')
  await fill('不能执行')
  expect(button('发送').disabled).toBe(true)
})
it('keeps every opened conversation synchronized with connected Tabs while the AI panel is hidden', async () => {
  await act(async () => {
    useAiStore.getState().put({ ...c, id: 'background-chat' })
    root.render(
      <TooltipProvider>
        <AiInspector open={false} overlay={false} onClose={() => {}} onChoose={() => {}} />
      </TooltipProvider>,
    )
  })
  api.ai.scope.mockClear()
  await act(async () =>
    useSessionStore.setState((state) => ({
      tabs: [
        state.tabs[1],
        { id: 'connecting', sessionId: 'c', profileId: 'r', profileName: '连接中', status: 'connecting' },
      ],
    })),
  )
  expect(api.ai.scope).toHaveBeenCalledWith({ conversationId: 'chat', sessionIds: ['b'] })
  expect(api.ai.scope).toHaveBeenCalledWith({ conversationId: 'background-chat', sessionIds: ['b'] })
  expect(
    Object.values(useAiStore.getState().conversations).every(
      (chat) => chat.targets.length === 1 && chat.targets[0].sessionId === 'b',
    ),
  ).toBe(true)
})
it('automatically reauthorizes the same session ID after its Tab reconnects', async () => {
  await act(async () =>
    useSessionStore.setState((state) => ({
      tabs: state.tabs.map((tab) => (tab.sessionId === 'a' ? { ...tab, status: 'reconnecting' } : tab)),
    })),
  )
  expect(api.ai.scope).toHaveBeenLastCalledWith({ conversationId: 'chat', sessionIds: ['b'] })
  await act(async () =>
    useSessionStore.setState((state) => ({
      tabs: state.tabs.map((tab) => (tab.sessionId === 'a' ? { ...tab, status: 'connected' } : tab)),
    })),
  )
  expect(api.ai.scope).toHaveBeenLastCalledWith({ conversationId: 'chat', sessionIds: ['a', 'b'] })
  expect(useAiStore.getState().selectedId).toBe('chat')
  expect(api.ai.open).not.toHaveBeenCalled()
})
it('refreshes bindings even when React batches reconnecting and connected into the same render', async () => {
  await act(async () => {
    useSessionStore.setState((state) => ({
      tabs: state.tabs.map((tab) => (tab.sessionId === 'a' ? { ...tab, status: 'reconnecting' } : tab)),
    }))
    useSessionStore.setState((state) => ({
      tabs: state.tabs.map((tab) => (tab.sessionId === 'a' ? { ...tab, status: 'connected' } : tab)),
    }))
  })
  expect(api.ai.scope).toHaveBeenLastCalledWith({ conversationId: 'chat', sessionIds: ['a', 'b'] })
  expect(api.ai.open).not.toHaveBeenCalled()
})
it('discards a removed runtime conversation without blocking synchronization for the remaining chats', async () => {
  await act(async () => useAiStore.getState().put({ ...c, id: 'background-chat' }))
  const scope = api.ai.scope.getMockImplementation()!
  api.ai.scope.mockImplementation(async (input) => {
    if (input.conversationId === 'background-chat')
      throw new DesktopError({ code: 'FORBIDDEN', message: '对话已移除' })
    return scope(input)
  })
  await act(async () => useSessionStore.setState((state) => ({ tabs: [state.tabs[1]] })))
  expect(useAiStore.getState().conversations['background-chat']).toBeUndefined()
  expect(useAiStore.getState().conversations.chat.targets.map((target) => target.sessionId)).toEqual(['b'])
  expect(document.querySelector('.ai-error-dialog')).toBeNull()
})
it('refreshes live bindings before every send even when connected Tab IDs are unchanged', async () => {
  await fill('读取当前系统')
  await act(async () => button('发送').click())
  expect(api.ai.scope).toHaveBeenCalledWith({ conversationId: 'chat', sessionIds: ['a', 'b'] })
  expect(api.ai.scope.mock.invocationCallOrder[0]).toBeLessThan(api.ai.send.mock.invocationCallOrder[0])
  expect(api.ai.send).toHaveBeenCalledTimes(1)
})
it('waits for a newer Tab range arriving during the pre-send refresh and dispatches once', async () => {
  let finish!: (value: AiConversation) => void
  api.ai.scope.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await fill('使用当前连接')
  await act(async () => button('发送').click())
  expect(api.ai.send).not.toHaveBeenCalled()
  await act(async () => useSessionStore.setState((state) => ({ tabs: [state.tabs[1]] })))
  expect(api.ai.scope).toHaveBeenCalledTimes(1)
  await act(async () => finish(c))
  expect(api.ai.scope).toHaveBeenLastCalledWith({ conversationId: 'chat', sessionIds: ['b'] })
  expect(useAiStore.getState().conversations.chat.targets.map((target) => target.sessionId)).toEqual(['b'])
  expect(api.ai.send).toHaveBeenCalledTimes(1)
})
it('a failed scope refresh preserves the draft and does not block later Tab synchronization', async () => {
  api.ai.scope.mockRejectedValueOnce(new Error('同步连接失败'))
  await fill('保留未发送指令')
  await act(async () => button('发送').click())
  expect(api.ai.send).not.toHaveBeenCalled()
  expect(host.querySelector('textarea')!.value).toBe('保留未发送指令')
  await act(async () => document.querySelector<HTMLButtonElement>('.ai-error-dialog button')!.click())
  await act(async () => useSessionStore.setState((state) => ({ tabs: [state.tabs[1]] })))
  expect(api.ai.scope).toHaveBeenLastCalledWith({ conversationId: 'chat', sessionIds: ['b'] })
  await act(async () => button('发送').click())
  expect(api.ai.send).toHaveBeenCalledTimes(1)
})
it('automatic Tab synchronization does not dismiss an error the user has not acknowledged', async () => {
  api.ai.scope.mockRejectedValueOnce(new Error('同步连接失败'))
  await act(async () => useSessionStore.setState((state) => ({ tabs: [state.tabs[1]] })))
  const dialog = document.querySelector('.ai-error-dialog')!
  expect(dialog.textContent).toContain('同步连接失败')
  await act(async () =>
    useSessionStore.setState((state) => ({
      tabs: [
        ...state.tabs,
        { id: 'tab-a', sessionId: 'a', profileId: 'p', profileName: '主机A', status: 'connected' },
      ],
    })),
  )
  expect(document.querySelector('.ai-error-dialog')).toBe(dialog)
  expect(dialog.textContent).toContain('同步连接失败')
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
  expect(document.querySelector('.ai-error-dialog [data-slot="dialog-description"]')?.textContent).toBe(
    '无法读取文件',
  )
  expect(host.querySelector('[role=alert]')).toBeNull()
})

it('uses the shared dialog for runtime errors and acknowledges one failure per conversation turn', async () => {
  const error = '连接范围或SSH连接实例已变化，请重新选择连接'
  const failed: AiConversation = { ...c, status: 'error', error }
  await act(async () => useAiStore.getState().put(failed))
  const dialog = document.querySelector('.ai-error-dialog')!
  expect(dialog.getAttribute('role')).toBe('dialog')
  expect(dialog.querySelector('[data-slot="dialog-title"]')?.textContent).toBe('AI 任务异常')
  expect(dialog.querySelector('[data-slot="dialog-description"]')?.textContent).toBe(error)
  expect(host.textContent).not.toContain(error)
  await act(async () => dialog.querySelector<HTMLButtonElement>('button')!.click())
  expect(document.querySelector('.ai-error-dialog')).toBeNull()
  await act(async () => useAiStore.getState().put({ ...failed, updatedAt: 100 }))
  expect(document.querySelector('.ai-error-dialog')).toBeNull()
  await act(async () =>
    useAiStore.getState().put({
      ...failed,
      messages: [...failed.messages, { id: 'u2', role: 'user', text: '再检查一次' }],
    }),
  )
  expect(document.querySelector('.ai-error-dialog [data-slot="dialog-description"]')?.textContent).toBe(error)
  expect(api.ai.send).not.toHaveBeenCalled()
})

it('warns about an unknown result in a dialog but does not warn about an older turn after history restoration', async () => {
  await pending({ state: 'unknown', error: '命令结果未知，请先核查' })
  await act(async () => useAiStore.getState().put({ ...c, status: 'paused' }))
  expect(document.querySelector('.ai-error-dialog [data-slot="dialog-title"]')?.textContent).toBe(
    'AI 任务已暂停',
  )
  expect(document.querySelector('.ai-error-dialog [data-slot="dialog-description"]')?.textContent).toBe(
    '命令结果未知，请先核查',
  )
  expect(host.querySelector('.ai-inspector > .ai-command-notice')).toBeNull()
  await act(async () => document.querySelector<HTMLButtonElement>('.ai-error-dialog button')!.click())
  await act(async () =>
    useAiStore.getState().put({
      ...c,
      status: 'paused',
      messages: [
        ...c.messages,
        { id: 'new-user', role: 'user', text: '后续检查' },
        { id: 'done', role: 'assistant', text: '检查完成' },
      ],
    }),
  )
  expect(document.querySelector('.ai-error-dialog')).toBeNull()
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
  expect(document.querySelector('.ai-error-dialog [data-slot="dialog-description"]')?.textContent).toBe(
    '设置执行模式失败',
  )
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
