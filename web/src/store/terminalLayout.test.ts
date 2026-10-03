import { beforeEach, expect, it, vi } from 'vitest'
import { useTerminalLayoutStore, resetTerminalLayout, restoreTerminalLayout } from './terminalLayout'
import { leaves, geometry, parseSplitTree, type SplitTree } from '@/lib/terminalLayout'
import { useSessionStore } from './session'
import { useProfileStore } from './profile'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import { localStateApi } from '@/api/localState'
import { sessionApi } from '@/api/session'
vi.mock('@/api/localState', () => ({ localStateApi: { read: vi.fn(), write: vi.fn() } }))
vi.mock('@/api/session', () => ({ sessionApi: { create: vi.fn(), close: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))
beforeEach(() => {
  vi.clearAllMocks(); resetTerminalLayout(); setWorkspaceGeneration(1)
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useProfileStore.setState(useProfileStore.getInitialState(), true)
})
it('四窗格上限、比例、焦点与合并保持连接，关闭仅关闭所属会话', () => {
  useSessionStore.setState({ tabs: [{ id: 'a', profileId: 'p', profileName: 'p', kind: 'terminal', status: 'connected', sessionId: 'ssh-one' }], activeTabId: 'a' })
  for (const axis of ['horizontal', 'vertical', 'horizontal'] as const) useTerminalLayoutStore.getState().split(axis)
  const state = useTerminalLayoutStore.getState()
  expect(leaves(state.tree)).toHaveLength(4)
  expect(() => state.split('vertical')).toThrow('四个')
  const split = state.tree as Extract<SplitTree, { type: 'split' }>
  state.resize(split.id, 0.9)
  expect(geometry(useTerminalLayoutStore.getState().tree).panes[0].width).toBe(85)
  expect(sessionApi.create).not.toHaveBeenCalled()
  state.focusNext(1); expect(useSessionStore.getState().activeTabId).toBe('a')
  state.maximize(); expect(useTerminalLayoutStore.getState().maximizedId).toBe('a')
  state.merge(); expect(leaves(useTerminalLayoutStore.getState().tree)).toEqual(['a'])
  expect(useSessionStore.getState().tabs).toHaveLength(4)
  expect(sessionApi.close).not.toHaveBeenCalled()
  useSessionStore.getState().closeTab('a')
  expect(sessionApi.close).toHaveBeenCalledExactlyOnceWith('ssh-one')
  expect(leaves(useTerminalLayoutStore.getState().tree)).toHaveLength(1)
})
it('从本地恢复服务器引用但不创建 SSH 会话或恢复输入', async () => {
  useProfileStore.setState({ profiles: [{ id: 'p', name: '服务器', host: 'localhost', port: 22, username: 'u' } as never] })
  vi.mocked(localStateApi.read).mockResolvedValue({ version: 1, tree: { type: 'split', id: 's', axis: 'horizontal', ratio: 0.4, first: { type: 'leaf', tabId: 'a' }, second: { type: 'leaf', tabId: 'b' } }, tabs: [{ id: 'a', profileId: 'p' }, { id: 'b', profileId: 'missing' }], focusedId: 'b' })
  await restoreTerminalLayout()
  expect(useSessionStore.getState().tabs.map((tab) => [tab.profileId, tab.status, tab.sessionId, tab.manualConnect])).toEqual([['p', 'disconnected', null, true], ['', 'disconnected', null, true]])
  expect(leaves(useTerminalLayoutStore.getState().tree)).toEqual(['a', 'b'])
  expect(sessionApi.create).not.toHaveBeenCalled()
})
it('旧账号恢复响应不污染新空间', async () => {
  let finish!: (value: unknown) => void
  vi.mocked(localStateApi.read).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const pending = restoreTerminalLayout()
  resetTerminalLayout(); setWorkspaceGeneration(2)
  finish({ version: 1, tabs: [{ id: 'a', profileId: 'p' }] }); await pending
  expect(useSessionStore.getState().tabs).toEqual([])
  expect(useTerminalLayoutStore.getState().ready).toBe(false)
})
it('拒绝重复叶、非法比例与深层损坏布局', () => {
  const leaf = { type: 'leaf', tabId: 'a' }
  const tree = { type: 'split', id: 's', axis: 'vertical', ratio: 0.5, first: leaf, second: leaf }
  expect(leaves(parseSplitTree(tree, new Set(['a'])))).toEqual(['a'])
  expect(parseSplitTree({ ...tree, ratio: Number.NaN }, new Set(['a']))).toBeNull()
})
