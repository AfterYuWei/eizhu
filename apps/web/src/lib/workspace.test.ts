// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applyWorkspace } from './workspace'
import { setWorkspaceGeneration } from './workspaceScope'
import { localStateApi } from '@/api/localState'
import { useDesktopShellStore } from '@/store/desktopShell'
import { useSessionStore } from '@/store/session'
import { useTerminalLayoutStore } from '@/store/terminalLayout'
import { useProfileStore } from '@/store/profile'
import { useVaultStore } from '@/store/vault'
import { useSyncStore } from '@/store/sync'

vi.mock('@/api/localState', () => ({ localStateApi: { read: vi.fn(), write: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  setWorkspaceGeneration(0)
  useDesktopShellStore.setState(useDesktopShellStore.getInitialState(), true)
  vi.spyOn(useProfileStore.getInitialState(), 'refreshAll').mockResolvedValue(undefined)
  vi.spyOn(useVaultStore.getInitialState(), 'fetchList').mockResolvedValue(undefined)
  vi.spyOn(useSyncStore.getInitialState(), 'refresh').mockResolvedValue(undefined)
  vi.mocked(localStateApi.write).mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

it('启动和重新进入空间只恢复文件夹状态，不读取旧会话快照', async () => {
  vi.mocked(localStateApi.read).mockImplementation(async (key) => key === 'sidebar_groups'
    ? { parent: true }
    : { version: 1, tree: { type: 'leaf', tabId: 'old' }, focusedId: 'old', tabs: [{ id: 'old', profileId: 'p' }] })
  applyWorkspace({ id: 'offline', generation: 1, userId: 0 })
  await Promise.resolve()
  expect(useSessionStore.getState().tabs).toEqual([])
  expect(useTerminalLayoutStore.getState().tree).toBeNull()
  expect(useDesktopShellStore.getState().collapsedGroups).toEqual({ parent: true })
  useSessionStore.getState().openDraftTab()
  useTerminalLayoutStore.getState().split('horizontal')
  expect(useSessionStore.getState().tabs).toHaveLength(2)

  applyWorkspace({ id: 'offline', generation: 2, userId: 0 })
  await Promise.resolve()
  expect(useSessionStore.getState()).toMatchObject({ tabs: [], activeTabId: null })
  expect(useTerminalLayoutStore.getState()).toMatchObject({ tree: null, focusedId: null, maximizedId: null })
  expect(useDesktopShellStore.getState().collapsedGroups).toEqual({ parent: true })
  expect(vi.mocked(localStateApi.read).mock.calls).toEqual([['sidebar_groups'], ['sidebar_groups']])
})
