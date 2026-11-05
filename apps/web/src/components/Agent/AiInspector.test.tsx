// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AiConversation, AiProposal } from '@eizhu/contracts'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAiStore } from '@/store/ai'
import { useSessionStore } from '@/store/session'
import { AiInspector } from './AiInspector'

const { api, terminalFocus } = vi.hoisted(() => ({
  api: {
    ai: { settings: vi.fn(), decide: vi.fn(), setTimeout: vi.fn(), send: vi.fn() },
    events: { on: vi.fn(() => () => {}) },
    clipboard: { write: vi.fn() },
  },
  terminalFocus: vi.fn(),
}))
vi.mock('@/lib/bridge', () => ({ bridge: () => api }))
vi.mock('@/lib/terminalActions', () => ({ terminalActions: () => ({ focus: terminalFocus }) }))
let host: HTMLDivElement, root: Root
let conversation: AiConversation
const proposal: AiProposal = {
  id: 'proposal',
  command: 'docker ps -a',
  cwd: '/root',
  purpose: '查看容器',
  impact: '只读查询',
  timeoutSeconds: 60,
  state: 'pending',
}
const updateProposal = (state: AiProposal['state']) => {
  conversation = {
    ...conversation,
    status: state === 'pending' ? 'awaiting_confirmation' : state === 'running' ? 'executing' : 'idle',
    messages: [
      conversation.messages[0],
      { id: 'command', role: 'assistant', text: '我先查看容器状态。', proposal: { ...proposal, state } },
    ],
  }
  useAiStore.getState().put(conversation)
}
const putProposal = (state: AiProposal['state'] = 'pending') => act(async () => updateProposal(state))
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!
const input = async (selector: string, value: string) => {
  await act(async () => {
    const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
    const prototype =
      field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  vi.stubGlobal('eizhu', api)
  api.ai.settings.mockResolvedValue({
    source: 'custom',
    endpoint: 'http://127.0.0.1',
    model: 'test-model',
    hasApiKey: true,
  })
  api.clipboard.write.mockResolvedValue(undefined)
  conversation = {
    id: 'conversation',
    profileId: 'profile',
    title: '查看容器',
    updatedAt: 0,
    source: 'custom',
    model: 'test-model',
    status: 'idle',
    error: '',
    messages: [{ id: 'user', role: 'user', text: '查看容器' }],
    target: {
      profileId: 'profile',
      sessionId: 'session',
      host: 'example.invalid',
      port: 22,
      username: 'root',
      cwd: '/root',
      system: '',
    },
  }
  useAiStore.setState(
    {
      ...useAiStore.getInitialState(),
      open: vi.fn().mockResolvedValue(undefined),
      tabs: { tab: conversation.id },
      conversations: { [conversation.id]: conversation },
    },
    true,
  )
  useSessionStore.setState(
    {
      ...useSessionStore.getInitialState(),
      tabs: [
        { id: 'tab', profileId: 'profile', profileName: '服务器', status: 'connected', sessionId: 'session' },
      ],
      activeTabId: 'tab',
    },
    true,
  )
  api.ai.decide.mockImplementation(async ({ accepted }: { accepted: boolean }) => {
    updateProposal(accepted ? 'running' : 'rejected')
  })
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
  useAiStore.setState(useAiStore.getInitialState(), true)
  useSessionStore.setState(useSessionStore.getInitialState(), true)
})

it('approval replaces the composer, copies without execution, and rejection restores the draft', async () => {
  await input('textarea', '接下来检查内存')
  await putProposal()
  expect(host.querySelector('.ai-composer [aria-label="命令执行审批"]')).not.toBeNull()
  expect(host.querySelector('textarea')).toBeNull()
  expect(host.querySelector('.ai-messages .ai-approval')).toBeNull()
  expect(button('允许执行').closest('.ai-composer')).not.toBeNull()
  expect(api.ai.decide).not.toHaveBeenCalled()
  await act(async () =>
    host.querySelector<HTMLButtonElement>('.ai-approval [aria-label="复制命令"]')!.click(),
  )
  expect(api.clipboard.write).toHaveBeenCalledWith({ text: proposal.command })
  expect(api.ai.decide).not.toHaveBeenCalled()
  await act(async () => button('拒绝').click())
  expect(api.ai.decide).toHaveBeenCalledWith({ proposalId: proposal.id, accepted: false })
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('接下来检查内存')
  expect(host.querySelector('.ai-approval')).toBeNull()
  expect(terminalFocus).not.toHaveBeenCalled()
})

it('approval executes directly without timeout controls or a timeout settings request', async () => {
  await putProposal()
  expect(host.querySelector('.ai-approval input')).toBeNull()
  expect(host.querySelector('.ai-approval')?.textContent).not.toContain('超时')
  await act(async () => button('允许执行').click())
  expect(api.ai.decide).toHaveBeenCalledWith({ proposalId: proposal.id, accepted: true })
  expect(api.ai.setTimeout).not.toHaveBeenCalled()
  expect(terminalFocus).toHaveBeenCalledOnce()
  expect(host.querySelector('.ai-approval')).toBeNull()
  expect(host.querySelector('.ai-command-status')?.textContent).toBe('执行中')
  expect(host.querySelector('textarea')).not.toBeNull()
})

it('approval failure retains the approval for review', async () => {
  api.ai.decide.mockRejectedValueOnce(new Error('审批失败'))
  await putProposal()
  await act(async () => button('允许执行').click())
  expect(host.querySelector('.ai-approval')).not.toBeNull()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('审批失败')
  expect(terminalFocus).not.toHaveBeenCalled()
})

it('disconnection disables the pending approval and history cannot recreate one', async () => {
  await putProposal()
  await act(async () =>
    useSessionStore.setState({
      tabs: [
        { id: 'tab', profileId: 'profile', profileName: '服务器', status: 'disconnected', sessionId: null },
      ],
    }),
  )
  expect(button('允许执行').disabled).toBe(true)
  expect(button('拒绝').disabled).toBe(true)
  await act(async () => useAiStore.getState().put({ ...conversation, status: 'idle' }))
  expect(host.querySelector('.ai-approval')).toBeNull()
  expect(api.ai.decide).not.toHaveBeenCalled()
})

it('one assistant turn shares its avatar and only the interpretation has reply actions', async () => {
  await putProposal('completed')
  await act(async () =>
    useAiStore.getState().put({
      ...conversation,
      messages: [
        ...conversation.messages,
        { id: 'interpretation', role: 'assistant', text: '所有容器均在运行。' },
      ],
    }),
  )
  expect(host.querySelectorAll('[aria-label="AI 头像"]')).toHaveLength(1)
  expect(host.querySelectorAll('.ai-reply-actions')).toHaveLength(1)
  expect(host.querySelector('.is-continuation')?.textContent).toContain('所有容器均在运行')
})
