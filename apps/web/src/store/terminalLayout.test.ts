import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTerminalLayoutStore, resetTerminalLayout } from './terminalLayout'
import { leaves, geometry, parseSplitTree, type SplitTree } from '@/lib/terminalLayout'
import { useSessionStore } from './session'
import { localStateApi } from '@/api/localState'
import { sessionApi } from '@/api/session'
vi.mock('@/api/localState', () => ({ localStateApi: { read: vi.fn(), write: vi.fn() } }))
vi.mock('@/api/session', () => ({ sessionApi: { create: vi.fn(), close: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))
beforeEach(() => {
  vi.clearAllMocks(); resetTerminalLayout()
  useSessionStore.setState(useSessionStore.getInitialState(), true)
})
afterEach(() => { resetTerminalLayout(); vi.useRealTimers() })
it('四窗格上限、比例、焦点与合并保持连接，关闭仅关闭所属会话', async () => {
  useSessionStore.setState({ tabs: [{ id: 'a', profileId: 'p', profileName: 'p', status: 'connected', sessionId: 'ssh-one' }], activeTabId: 'a' })
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
  await useSessionStore.getState().closeTab('a')
  expect(sessionApi.close).toHaveBeenCalledExactlyOnceWith('ssh-one')
  expect(leaves(useTerminalLayoutStore.getState().tree)).toHaveLength(1)
})
it('拒绝重复叶、非法比例与深层损坏布局', () => {
  const leaf = { type: 'leaf', tabId: 'a' }
  const tree = { type: 'split', id: 's', axis: 'vertical', ratio: 0.5, first: leaf, second: leaf }
  expect(leaves(parseSplitTree(tree, new Set(['a'])))).toEqual(['a'])
  expect(parseSplitTree({ ...tree, ratio: Number.NaN }, new Set(['a']))).toBeNull()
})

it('新建、分屏与关闭标签只改变当前窗口，不读取或保存会话快照', async () => {
  vi.useFakeTimers()
  useSessionStore.setState({ tabs: [{ id: 'a', profileId: 'p', profileName: '服务器', status: 'connected', sessionId: 'ssh' }], activeTabId: 'a' })
  useTerminalLayoutStore.getState().split('horizontal')
  await vi.advanceTimersByTimeAsync(300)
  expect(useSessionStore.getState().tabs).toHaveLength(2)
  expect(leaves(useTerminalLayoutStore.getState().tree)).toHaveLength(2)
  await useSessionStore.getState().closeTab('a')
  await vi.advanceTimersByTimeAsync(300)
  expect(useSessionStore.getState().tabs).toHaveLength(1)
  expect(localStateApi.read).not.toHaveBeenCalled()
  expect(localStateApi.write).not.toHaveBeenCalled()
})
