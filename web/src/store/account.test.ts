import { beforeEach, describe, expect, it, vi } from 'vitest'
import { accountApi } from '@/api/account'
import { useAccountStore } from './account'

vi.mock('@/api/account', () => ({ accountApi: {
  status: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn(), me: vi.fn(), setSyncEnabled: vi.fn(),
} }))

const loggedIn = { loggedIn: true, syncEnabled: true, user: { email: 'u@example.com', storageUsed: 2, storageQuota: 10 } }

beforeEach(() => {
  vi.clearAllMocks()
  useAccountStore.setState({ status: null, loading: false, error: null })
})

describe('account store', () => {
  it('水合并切换账号同步', async () => {
    vi.mocked(accountApi.status).mockResolvedValue(loggedIn)
    vi.mocked(accountApi.setSyncEnabled).mockResolvedValue({ ...loggedIn, syncEnabled: false })
    await useAccountStore.getState().hydrate()
    expect(useAccountStore.getState().status).toEqual(loggedIn)
    await useAccountStore.getState().setSyncEnabled(false)
    expect(useAccountStore.getState().status?.syncEnabled).toBe(false)
  })

  it('退出后立即清空展示状态', async () => {
    useAccountStore.setState({ status: loggedIn })
    vi.mocked(accountApi.logout).mockResolvedValue(undefined)
    await useAccountStore.getState().logout()
    expect(useAccountStore.getState().status).toEqual({ loggedIn: false, syncEnabled: false })
  })
})
