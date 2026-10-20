import { beforeEach, expect, it, vi } from 'vitest'
import { localStateApi } from '@/api/localState'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import { useHistoryStore } from './history'
vi.mock('@/api/localState', () => ({ localStateApi: { history: vi.fn(), read: vi.fn(), write: vi.fn(), record: vi.fn(), remove: vi.fn() } }))
beforeEach(() => { vi.resetAllMocks(); setWorkspaceGeneration(1); useHistoryStore.setState(useHistoryStore.getInitialState(), true) })
it('private tabs and disabled history never invoke persistence', async () => {
  useHistoryStore.getState().setPrivate('tab', true)
  await useHistoryStore.getState().record('profile', 'tab', 'pwd')
  useHistoryStore.setState({ settings: { enabled: false, maxEntries: 500, retentionDays: 30 } })
  await useHistoryStore.getState().record('profile', 'other', 'pwd')
  expect(localStateApi.record).not.toHaveBeenCalled()
})
it('late history from a previous workspace cannot populate the current store', async () => {
  let resolve!: (value: []) => void
  vi.mocked(localStateApi.history).mockReturnValue(new Promise((r) => { resolve = r }))
  vi.mocked(localStateApi.read).mockResolvedValue(null)
  const pending = useHistoryStore.getState().load('profile')
  setWorkspaceGeneration(2); resolve([]); await pending
  expect(useHistoryStore.getState().entries).toEqual({})
})
