import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const { api } = vi.hoisted(() => ({ api: {
  transfer: vi.fn(), listTransfers: vi.fn(), list: vi.fn(), closeSession: vi.fn(),
  getTransferConflicts: vi.fn(), resolveTransferConflicts: vi.fn(), cancelTransfer: vi.fn(),
} }))
vi.mock('@/api/sftp', () => ({ sftpApi: api }))
import { createSftpStore, type SftpStoreApi, type SftpTab } from './sftp'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import type { TransferTask } from '@/types/sftp'

const stores: SftpStoreApi[] = []
const task = (id: string, status: TransferTask['status'] = 'transferring'): TransferTask => ({
  id, status, file_name: id, direction: 'transfer', size: 100, transferred: status === 'completed' ? 100 : 0,
  speed: 0, started_at: 1, target_profile: 'target', execution_generation: 1,
})
const setup = () => {
  const store = createSftpStore({ includeLocalTab: false })
  stores.push(store)
  const tab: SftpTab = {
    id: 'right', server: { id: 'target', name: '目标', host: 'host', port: 22, username: 'user' },
    sessionId: 'target-session', path: '/dest', view: 'list', showHidden: false, selected: new Set(),
    entries: [], tree: null, connecting: false, loading: false, error: null, fetchSeq: 0,
  }
  store.setState({ rightTabs: [tab], activeRightTabId: tab.id, pendingDirectoryDrop: {
    drag: { sourcePane: 'left', sourceTabId: 'left', sourceSessionId: 'source-session', entries: [
      { name: 'project', path: '/project', is_dir: true, size: 0, mod_time: '' },
    ] },
    target: { pane: 'right', tabId: 'right', sessionId: 'target-session', serverName: '目标', destDir: '/dest', kind: 'current' },
  } })
  return store
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  setWorkspaceGeneration(1)
  api.closeSession.mockResolvedValue(undefined)
  api.list.mockImplementation(async (_id, path) => ({ path, entries: [] }))
})
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.getState().dispose()))
  vi.useRealTimers()
})

it('接收只有 tasks 的真实响应，整批任务共用一个轮询，分别完成后刷新目标', async () => {
  const store = setup()
  api.transfer.mockResolvedValue({ tasks: [task('one'), task('two')] })
  api.listTransfers.mockResolvedValueOnce([task('one', 'completed'), task('two')])
    .mockResolvedValue([task('one', 'completed'), task('two', 'completed')])
  await store.getState().resolveDirectoryDrop('preserve')
  expect(store.getState().transfers).toHaveLength(2)
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersByTimeAsync(800)
  expect(api.listTransfers).toHaveBeenCalledTimes(1)
  expect(api.list).toHaveBeenCalledTimes(1)
  expect(store.getState().transfers[1].status).toBe('transferring')
  await vi.advanceTimersByTimeAsync(800)
  expect(api.listTransfers).toHaveBeenCalledTimes(2)
  expect(api.list).toHaveBeenCalledTimes(2)
  expect(store.getState().transfers.every((row) => row.status === 'completed')).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('超过十分钟仍跟踪任务，暂停后停止轮询，恢复后重新跟踪', async () => {
  const store = setup()
  api.listTransfers.mockResolvedValue([task('long')])
  store.getState().acceptTransferTasks([task('long')])
  await vi.advanceTimersByTimeAsync(800)
  vi.setSystemTime(Date.now() + 11 * 60 * 1000)
  await vi.advanceTimersByTimeAsync(800)
  expect(api.listTransfers).toHaveBeenCalledTimes(2)
  store.getState().acceptTransferTasks([task('long', 'paused')])
  await vi.advanceTimersByTimeAsync(800)
  expect(vi.getTimerCount()).toBe(0)
  store.getState().acceptTransferTasks([{ ...task('long'), execution_generation: 2 }])
  api.listTransfers.mockResolvedValue([{ ...task('long', 'completed'), execution_generation: 2 }])
  await vi.advanceTimersByTimeAsync(800)
  expect(store.getState().transfers[0].status).toBe('completed')
})

it('空间切换丢弃迟到的传输请求，释放页面后不再查询任务', async () => {
  const store = setup()
  let resolve!: (value: { tasks: TransferTask[] }) => void
  api.transfer.mockReturnValue(new Promise((done) => { resolve = done }))
  const request = store.getState().resolveDirectoryDrop('preserve')
  setWorkspaceGeneration(2)
  resolve({ tasks: [task('old')] })
  await request
  expect(store.getState().transfers).toEqual([])
  await store.getState().dispose()
  await vi.advanceTimersByTimeAsync(1600)
  expect(api.listTransfers).not.toHaveBeenCalled()
})

it('后台冲突进入原有确认流程，在同一个任务上处理，取消会终止等待的任务', async () => {
  const store = setup(), waiting = { ...task('conflict', 'paused'), conflict_count: 1, error_code: 'TRANSFER_CONFLICT' }
  const conflicts = [{ source_path: '/project/a', dest_path: '/dest/project/a', source_size: 1, dest_size: 1 }]
  api.getTransferConflicts.mockResolvedValue({ conflicts })
  api.resolveTransferConflicts.mockResolvedValue({ ...task('conflict'), execution_generation: 2 })
  store.getState().acceptTransferTasks([waiting], { pane: 'right', tabId: 'right' })
  await Promise.resolve()
  expect(store.getState().pendingConflict).toEqual({ taskId: 'conflict', operation: 'transfer', conflicts })
  await store.getState().resolveConflict('rename')
  expect(api.resolveTransferConflicts).toHaveBeenCalledExactlyOnceWith('conflict', 'rename')
  expect(api.transfer).not.toHaveBeenCalled()
  store.getState().acceptTransferTasks([{ ...waiting, execution_generation: 2 }])
  await store.getState().openTransferConflict('conflict')
  api.cancelTransfer.mockResolvedValue({ ...task('conflict', 'cancelled'), execution_generation: 2 })
  store.getState().dismissConflict()
  await Promise.resolve()
  await Promise.resolve()
  expect(api.cancelTransfer).toHaveBeenCalledExactlyOnceWith('conflict')
  expect(store.getState().pendingConflict).toBeNull()
})
