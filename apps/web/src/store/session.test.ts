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

it('waits for the backend to release a cancelled session and detaches only this tab from server details', async () => {
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
    .cancelConnection('tab')
    .then(() => {
      finished = true
    })
  expect(finished).toBe(false)
  expect(useSessionStore.getState().tabs[0]).toMatchObject({
    status: 'disconnected',
    sessionId: 'ssh',
    manualConnect: true,
    reconnectAttempt: undefined,
    nextRetryAt: undefined,
  })
  expect(disconnect).not.toHaveBeenCalled()
  release()
  await cancellation
  expect(finished).toBe(true)
  expect(disconnect).toHaveBeenCalledExactlyOnceWith('server')
  expect(useSessionStore.getState().tabs[0]).toMatchObject({
    id: 'tab',
    sessionId: null,
    detailAttached: false,
  })
  expect(useSessionStore.getState().activeTabId).toBe('tab')
})

it('closes a late create response after cancellation without reopening or removing the tab', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof sessionApi.create>>) => void
  vi.mocked(sessionApi.create).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const pending = useSessionStore.getState().openTab('server', '服务器')
  const id = useSessionStore.getState().tabs[0].id
  await useSessionStore.getState().cancelConnection(id)
  resolve({ session_id: 'late-ssh', status: 'connecting' })
  await pending
  expect(sessionApi.close).toHaveBeenCalledExactlyOnceWith('late-ssh')
  expect(useSessionStore.getState().tabs).toHaveLength(1)
  expect(useSessionStore.getState().tabs[0]).toMatchObject({
    id,
    status: 'disconnected',
    sessionId: null,
    manualConnect: true,
  })
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
  await useSessionStore.getState().cancelConnection(id)
  reject({ error: { code: 'SSH_AUTH_FAILED', message: '认证失败' } })
  await pending
  expect(useSessionStore.getState().tabs[0]).toMatchObject({
    status: 'disconnected',
    errorReason: undefined,
    errorMessage: undefined,
  })
})
