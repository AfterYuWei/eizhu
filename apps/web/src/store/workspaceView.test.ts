import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetWorkspaceView, useWorkspaceViewStore } from './workspaceView'
import { useSessionStore } from './session'
import { profileApi } from '@/api/profile'
import { sftpApi } from '@/api/sftp'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import type { Profile } from '@/types/profile'

vi.mock('@/api/profile', () => ({ profileApi: { list: vi.fn() } }))
vi.mock('@/api/sftp', () => ({ sftpApi: { createSession: vi.fn(), closeSession: vi.fn(), getSession: vi.fn(), list: vi.fn() } }))
const profile = { id: 'p', name: '服务器', host: 'example.test', port: 22, username: 'root' } as Profile

beforeEach(async () => {
  await resetWorkspaceView()
  vi.resetAllMocks()
  setWorkspaceGeneration(1)
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  vi.mocked(profileApi.list).mockResolvedValue([profile])
  vi.mocked(sftpApi.closeSession).mockResolvedValue(undefined)
  vi.mocked(sftpApi.createSession).mockResolvedValue({ session_id: 'remote', status: 'connected', home_dir: '/home' })
  vi.mocked(sftpApi.getSession).mockResolvedValue({ status: 'connected' } as never)
  vi.mocked(sftpApi.list).mockImplementation(async (_id, path) => ({ path, entries: [] }))
})
afterEach(resetWorkspaceView)

it('两个工具各自复用当前空间的页面，普通导航不改变内部连接、目录或选择', async () => {
  const id = useSessionStore.getState().openDraftTab()
  await useWorkspaceViewStore.getState().openSftp('p', '/work')
  const store = useWorkspaceViewStore.getState().sftpStore!
  store.getState().select('right', '/work/file.txt')
  const tab = store.getState().rightTabs[0]
  useWorkspaceViewStore.getState().openVault()
  useWorkspaceViewStore.getState().openVault()
  useSessionStore.getState().setActiveTab(id)
  await useWorkspaceViewStore.getState().openSftp()
  await useWorkspaceViewStore.getState().openSftp()
  expect(useWorkspaceViewStore.getState()).toMatchObject({ activePage: 'sftp', vaultOpened: true, sftpStore: store })
  expect(store.getState().rightTabs[0]).toBe(tab)
  expect(tab).toMatchObject({ sessionId: 'remote', path: '/work', selected: new Set(['/work/file.txt']) })
  expect(useSessionStore.getState().tabs.map((item) => item.id)).toEqual([id])
  expect(sftpApi.createSession).toHaveBeenCalledExactlyOnceWith('p')
  expect(sftpApi.closeSession).not.toHaveBeenCalled()
})

it('从终端反复定位同一服务器时复用内部连接，快速定位以最后一次为准', async () => {
  await useWorkspaceViewStore.getState().openSftp('p', '/first')
  await Promise.all([
    useWorkspaceViewStore.getState().openSftp('p', '/outdated'),
    useWorkspaceViewStore.getState().openSftp('p', '/latest'),
  ])
  expect(sftpApi.createSession).toHaveBeenCalledTimes(1)
  expect(useWorkspaceViewStore.getState().sftpStore!.getState().rightTabs).toHaveLength(1)
  expect(useWorkspaceViewStore.getState().sftpStore!.getState().rightTabs[0].path).toBe('/latest')
  expect(sftpApi.list).not.toHaveBeenCalledWith('remote', '/outdated', false)
})

it('重置会等待资源释放，旧空间请求不会连接新空间或重新打开页面', async () => {
  let release!: () => void
  await useWorkspaceViewStore.getState().openSftp('p', '/work')
  const old = useWorkspaceViewStore.getState().sftpStore!
  vi.mocked(sftpApi.closeSession).mockImplementation(() => new Promise((resolve) => { release = resolve }))
  let finished = false
  const reset = resetWorkspaceView().then(() => { finished = true })
  expect(useWorkspaceViewStore.getState()).toMatchObject({ activePage: 'terminal', sftpStore: null, vaultOpened: false })
  expect(finished).toBe(false)
  expect(old.getState().rightTabs).toHaveLength(0)
  setWorkspaceGeneration(2)
  await old.getState().connectServer('right', profile)
  expect(sftpApi.createSession).toHaveBeenCalledTimes(1)
  release()
  await reset
  expect(finished).toBe(true)
  await useWorkspaceViewStore.getState().openSftp()
  expect(useWorkspaceViewStore.getState().sftpStore).not.toBe(old)
})

it('切换空间时丢弃尚未加载完成的服务器定位请求', async () => {
  let resolve!: (profiles: Profile[]) => void
  vi.mocked(profileApi.list).mockReturnValue(new Promise((done) => { resolve = done }))
  const pending = useWorkspaceViewStore.getState().openSftp('p', '/old')
  await resetWorkspaceView()
  setWorkspaceGeneration(2)
  resolve([profile])
  await pending
  expect(sftpApi.createSession).not.toHaveBeenCalled()
  expect(useWorkspaceViewStore.getState().sftpStore).toBeNull()
})
