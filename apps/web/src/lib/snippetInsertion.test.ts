import { beforeEach, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/store/session'
import { setWorkspaceGeneration } from './workspaceScope'
import { registerTerminalActions } from './terminalActions'
import { snippetTarget, insertSnippet } from './snippetInsertion'
beforeEach(() => {
  setWorkspaceGeneration(1)
  useSessionStore.setState({ activeTabId: 't', tabs: [{ id: 't', kind: 'terminal', profileId: 'p', profileName: 'p', sessionId: 's', status: 'connected' }] })
})
it('single lines insert without executing and multiline requires a safe paste mode', () => {
  const insert = vi.fn()
  const unregister = registerTerminalActions('t', { insert, focus: vi.fn(), reconnect: vi.fn(), search: vi.fn(), safeMultiline: () => false })
  const target = snippetTarget()!
  insertSnippet(target, 'pwd')
  expect(insert).toHaveBeenCalledWith('pwd', false)
  expect(() => insertSnippet(target, 'pwd\nls')).toThrow('安全的多行粘贴')
  expect(insert).toHaveBeenCalledTimes(1)
  unregister()
})
it('explicit execution normalizes lines and rejects stale connection or workspace targets', () => {
  const insert = vi.fn()
  const unregister = registerTerminalActions('t', { insert, focus: vi.fn(), reconnect: vi.fn(), search: vi.fn(), safeMultiline: () => true })
  const target = snippetTarget()!
  insertSnippet(target, 'pwd\r\nls', true)
  expect(insert).toHaveBeenCalledWith('pwd\nls', true)
  setWorkspaceGeneration(2)
  expect(() => insertSnippet(target, 'pwd', true)).toThrow('目标终端已变化')
  setWorkspaceGeneration(1)
  useSessionStore.setState({ tabs: useSessionStore.getState().tabs.map((t) => ({ ...t, sessionId: 'new' })) })
  expect(() => insertSnippet(target, 'pwd', true)).toThrow('目标终端已变化')
  unregister()
})
