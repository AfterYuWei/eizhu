import { beforeEach, expect, it, vi } from 'vitest'
const { api } = vi.hoisted(() => ({ api: { createSession: vi.fn(), closeSession: vi.fn(), getInfo: vi.fn(), listFiles: vi.fn() } }))
vi.mock('@/api/serverDetail', () => ({ serverDetailApi: api }))
vi.mock('@/lib/editorWindow', () => ({ openEditorFile: vi.fn() }))
vi.mock('@/store/profile', () => ({ useProfileStore: { getState: () => ({ updateDetectedIcon: vi.fn() }) } }))
import { useServerDetailStore as store } from './serverDetail'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import { DesktopError } from '@eizhu/contracts'
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
it.each(['success', 'failure'])('快速切换目录后丢弃旧列表的迟到 %s 结果', async (result) => {
  await store.getState().connect('p')
  let resolve!: (response: { path: string; entries: [] }) => void
  let reject!: (error: Error) => void
  api.listFiles.mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail }))
  const oldListing = store.getState().listFiles('p', '/old')
  api.listFiles.mockResolvedValueOnce({ path: '/current', entries: [{ name: 'current.txt', path: '/current/current.txt', is_dir: false, size: 1, mod_time: '' }] })
  await store.getState().listFiles('p', '/current')
  if (result === 'success') resolve({ path: '/old', entries: [] })
  else reject(new Error('旧目录读取失败'))
  await oldListing
  expect(store.getState().details.p.currentPath).toBe('/current')
  expect(store.getState().details.p.files.map((file) => file.name)).toEqual(['current.txt'])
  expect(store.getState().details.p.error).toBeNull()
  expect(store.getState().details.p.loading).toBe(false)
})

it('文件连接失效时结束加载并保留原目录，重新建立详情连接不增加所有者', async () => {
  await store.getState().connect('p')
  await store.getState().listFiles('p', '/work')
  api.listFiles.mockRejectedValueOnce(new DesktopError({ code: 'SFTP_NOT_CONNECTED', message: '文件连接已断开' }))
  await store.getState().listFiles('p', '/next')
  expect(store.getState().details.p).toMatchObject({ status: 'disconnected', loading: false, currentPath: '/work', refCount: 1 })
  api.createSession.mockResolvedValueOnce({ session_id: 'recovered', home_dir: '/home' })
  await store.getState().ensureConnected('p')
  expect(api.listFiles).toHaveBeenLastCalledWith('recovered', '/work', false)
  expect(store.getState().details.p.refCount).toBe(1)
})

it('断开后的旧目录响应不能恢复文件列表或覆盖重连状态', async () => {
  await store.getState().connect('p')
  let resolve!: (response: { entries: [] }) => void
  api.listFiles.mockReturnValueOnce(new Promise((done) => { resolve = done }))
  const pending = store.getState().listFiles('p', '/work')
  store.getState().markDisconnected('p')
  resolve({ entries: [] })
  await pending
  expect(store.getState().details.p).toMatchObject({ status: 'disconnected', loading: false, error: '文件连接已断开' })
})
