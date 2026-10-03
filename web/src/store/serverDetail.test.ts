import { beforeEach, expect, it, vi } from 'vitest'
const { api } = vi.hoisted(() => ({ api: { createSession: vi.fn(), closeSession: vi.fn(), getInfo: vi.fn(), listFiles: vi.fn() } }))
vi.mock('@/api/serverDetail', () => ({ serverDetailApi: api }))
vi.mock('@/lib/editorWindow', () => ({ openEditorFile: vi.fn() }))
vi.mock('@/store/profile', () => ({ useProfileStore: { getState: () => ({ updateDetectedIcon: vi.fn() }) } }))
import { useServerDetailStore as store } from './serverDetail'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
beforeEach(() => {
  store.setState(store.getInitialState(), true); setWorkspaceGeneration(1); vi.resetAllMocks()
  api.closeSession.mockResolvedValue(undefined); api.getInfo.mockResolvedValue({ icon: '' }); api.listFiles.mockResolvedValue({ entries: [] }); api.createSession.mockResolvedValue({ session_id: 'session', home_dir: '/home' })
})
it('相同服务器共享连接，最后一个标签关闭才释放', async () => {
  await store.getState().connect('p'); await store.getState().connect('p')
  expect(api.createSession).toHaveBeenCalledTimes(1); expect(store.getState().details.p.refCount).toBe(2)
  store.getState().disconnect('p'); expect(api.closeSession).not.toHaveBeenCalled()
  store.getState().disconnect('p'); expect(api.closeSession).toHaveBeenCalledWith('session'); expect(store.getState().details.p).toBeUndefined()
})
it('关闭标签及切换空间不会被迟到连接结果重新创建，迟到会话会清理', async () => {
  let resolve!: (response: { session_id: string }) => void
  api.createSession.mockImplementation(() => new Promise((done) => { resolve = done }))
  const connecting = store.getState().connect('p'); store.getState().disconnect('p'); resolve({ session_id: 'late' }); await connecting
  expect(store.getState().details.p).toBeUndefined(); expect(api.closeSession).toHaveBeenCalledWith('late')
  const old = store.getState().connect('p'); setWorkspaceGeneration(2); store.setState(store.getInitialState(), true); resolve({ session_id: 'old' }); await old
  expect(store.getState().details).toEqual({}); expect(api.closeSession).toHaveBeenCalledWith('old')
})
it('样本限额与账号重置清空，不保存到持久化', async () => {
  await store.getState().connect('p')
  for (let index = 1; index <= 130; index++) store.getState().updateMetrics('p', { ...store.getState().details.p.metrics, timestamp: index * 3000, cpu: 20 })
  expect(store.getState().details.p.samples).toHaveLength(120)
  setWorkspaceGeneration(2); store.setState(store.getInitialState(), true)
  expect(store.getState().details).toEqual({})
})
