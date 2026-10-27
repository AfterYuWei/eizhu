import { confirmAccountEditorChange } from '@/lib/accountEditorGuard'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { accountApi } from '@/api/account'
import { useAccountStore } from './account'
import type { AccountStatus } from '@/types/account'

vi.mock('@/lib/accountEditorGuard', () => ({ confirmAccountEditorChange: vi.fn().mockResolvedValue(true) }))

vi.mock('@/lib/workspace', () => ({ refreshWorkspace: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/api/account', () => ({ accountApi: {
  status: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn(), me: vi.fn(), setSyncEnabled: vi.fn(),
} }))

const loggedIn: AccountStatus = { loggedIn: true, sessionState: 'authenticated', syncEnabled: true, user: { id: 42, emailVerified: true, verificationRequired: true, email: 'u@example.com', storageUsed: 2, storageQuota: 10 } }

beforeEach(() => {
  vi.mocked(accountApi.status).mockReset()
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
    expect(useAccountStore.getState().status).toEqual({ loggedIn: false, sessionState: 'anonymous', syncEnabled: false })
  })
  it('退出远端失败后核对真实本地登录状态', async () => {
    useAccountStore.setState({ status: loggedIn })
    vi.mocked(accountApi.logout).mockRejectedValue(new Error('离线'))
    vi.mocked(accountApi.status).mockResolvedValue({ loggedIn: false, sessionState: 'anonymous', syncEnabled: false })
    await useAccountStore.getState().logout()
    expect(useAccountStore.getState().status?.loggedIn).toBe(false)
  })
  it('空间切换失败保留真实账号状态', async () => {
    vi.mocked(accountApi.logout).mockRejectedValue(new Error('空间不可用'))
    vi.mocked(accountApi.status).mockResolvedValue(loggedIn)
    await useAccountStore.getState().logout()
    expect(useAccountStore.getState().status).toEqual(loggedIn)
  })
  it('退出和状态查询均失败时保留账号展示并报告错误', async () => {
    useAccountStore.setState({ status: loggedIn })
    vi.mocked(accountApi.logout).mockRejectedValue(new Error('空间切换失败'))
    vi.mocked(accountApi.status).mockRejectedValue(new Error('业务线程不可用'))
    await useAccountStore.getState().logout()
    expect(useAccountStore.getState().status).toEqual(loggedIn)
    expect(useAccountStore.getState().error).toBe('空间切换失败')
  })

})

it('account changes are cancelled before authentication or workspace mutation when editor declines', async () => {
  vi.mocked(confirmAccountEditorChange).mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(false)
  useAccountStore.setState({ status: loggedIn })
  await useAccountStore.getState().login('email', 'password')
  await useAccountStore.getState().register('email', 'password')
  await useAccountStore.getState().logout()
  expect(accountApi.login).not.toHaveBeenCalled()
  expect(accountApi.register).not.toHaveBeenCalled()
  expect(accountApi.logout).not.toHaveBeenCalled()
  expect(useAccountStore.getState().status).toEqual(loggedIn)
})
