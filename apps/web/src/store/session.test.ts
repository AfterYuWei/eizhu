import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sessionApi } from '@/api/session'
import { useSessionStore } from './session'

vi.mock('@/api/session', () => ({ sessionApi: { create: vi.fn(), close: vi.fn() } }))
vi.mock('./serverDetail', () => ({ useServerDetailStore: { getState: () => ({ disconnect }) } }))
const { disconnect } = vi.hoisted(() => ({ disconnect: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(sessionApi.close).mockResolvedValue(undefined)
  useSessionStore.setState(useSessionStore.getInitialState(), true)
})
afterEach(() => useSessionStore.setState(useSessionStore.getInitialState(), true))

it('关闭标签前等待会话释放，并解除服务器详情引用', async () => {
  useSessionStore.setState({
    tabs: [
      {
        id: 'tab',
        profileId: 'server',
        profileName: '服务器',
        sessionId: 'ssh',
        status: 'reconnecting',
        detailAttached: true,
        reconnectAttempt: 3,
        nextRetryAt: Date.now() + 10000,
      },
    ],
    activeTabId: 'tab',
  })
  let release!: () => void
  vi.mocked(sessionApi.close).mockReturnValue(
    new Promise((done) => {
      release = done
    }),
  )
  let finished = false
  const cancellation = useSessionStore
    .getState()
    .closeTab('tab')
    .then(() => {
      finished = true
    })
  expect(finished).toBe(false)
  expect(useSessionStore.getState().tabs[0]).toMatchObject({
    status: 'reconnecting',
    sessionId: 'ssh',
  })
  expect(disconnect).not.toHaveBeenCalled()
  release()
  await cancellation
  expect(finished).toBe(true)
  expect(disconnect).toHaveBeenCalledExactlyOnceWith('server')
  expect(useSessionStore.getState().tabs).toEqual([])
  expect(useSessionStore.getState().activeTabId).toBeNull()
})

it('取消创建中的连接后移除标签，并释放迟到的会话', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof sessionApi.create>>) => void
  vi.mocked(sessionApi.create).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const pending = useSessionStore.getState().openTab('server', '服务器')
  const id = useSessionStore.getState().tabs[0].id
  await useSessionStore.getState().closeTab(id)
  expect(useSessionStore.getState().tabs).toEqual([])
  resolve({ session_id: 'late-ssh', status: 'connecting' })
  await pending
  expect(sessionApi.close).toHaveBeenCalledExactlyOnceWith('late-ssh')
  expect(useSessionStore.getState().tabs).toEqual([])
  expect(useSessionStore.getState().activeTabId).toBeNull()
})

it('discards a create failure received after cancellation', async () => {
  let reject!: (reason: unknown) => void
  vi.mocked(sessionApi.create).mockReturnValue(
    new Promise((_done, fail) => {
      reject = fail
    }),
  )
  const pending = useSessionStore.getState().openTab('server', '服务器')
  const id = useSessionStore.getState().tabs[0].id
  await useSessionStore.getState().closeTab(id)
  reject({ error: { code: 'SSH_AUTH_FAILED', message: '认证失败' } })
  await pending
  expect(useSessionStore.getState().tabs).toEqual([])
  expect(useSessionStore.getState().activeTabId).toBeNull()
})

it.each(['first', 'last'])('关闭连接标签沿用选中规则：当前标签为 %s', async (activeTabId) => {
  useSessionStore.setState({
    tabs: ['first', 'last'].map((id) => ({
      id, profileId: id, profileName: id, sessionId: id, status: 'connecting',
    })),
    activeTabId,
  })
  await useSessionStore.getState().closeTab('last')
  expect(sessionApi.close).toHaveBeenCalledExactlyOnceWith('last')
  expect(useSessionStore.getState().tabs.map((tab) => tab.id)).toEqual(['first'])
  expect(useSessionStore.getState().activeTabId).toBe('first')
})

it('连接携带用户选择的目标，旧会话或其他服务器的元数据不能覆盖标签', async () => {
  vi.mocked(sessionApi.create).mockResolvedValue({ session_id: 'ssh-a', status: 'connecting' })
  const id = await useSessionStore.getState().openTab('a', '服务器 A', 'a.example.test', 2222, 'user-a')
  expect(sessionApi.create).toHaveBeenCalledWith({ profile_id: 'a', expected_target: { host: 'a.example.test', port: 2222 }, cols: 80, rows: 24 })
  const target = { profile_id: 'a', profile_name: '实际名称', host: 'actual.example.test', port: 2200, username: 'actual-user' }
  useSessionStore.getState().updateTabTarget(id, 'old-ssh', target)
  useSessionStore.getState().updateTabTarget(id, 'ssh-a', { ...target, profile_id: 'b' })
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ profileName: '服务器 A', host: 'a.example.test', port: 2222, username: 'user-a' })
  useSessionStore.getState().updateTabTarget(id, 'ssh-a', target)
  expect(useSessionStore.getState().tabs[0]).toMatchObject({ profileId: 'a', profileName: '实际名称', host: 'actual.example.test', port: 2200, username: 'actual-user' })
})
