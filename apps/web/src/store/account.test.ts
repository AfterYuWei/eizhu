import { beforeEach, describe, expect, it, vi } from 'vitest'
import { accountApi } from '@/api/account'
import { useAccountStore } from './account'
import type { AccountStatus } from '@/types/account'

vi.mock('@/lib/workspace', () => ({ refreshWorkspace: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/api/account', () => ({
  accountApi: {
    status: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    setSyncEnabled: vi.fn(),
  },
}))

const loggedIn: AccountStatus = {
  loggedIn: true,
  sessionState: 'authenticated',
  syncEnabled: true,
  user: {
    id: 42,
    emailVerified: true,
    verificationRequired: true,
    email: 'u@example.com',
    storageUsed: 2,
    storageQuota: 10,
  },
}

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
    expect(useAccountStore.getState().status).toEqual({
      loggedIn: false,
      sessionState: 'anonymous',
      syncEnabled: false,
    })
  })
  it('退出远端失败后核对真实本地登录状态', async () => {
    useAccountStore.setState({ status: loggedIn })
    vi.mocked(accountApi.logout).mockRejectedValue(new Error('离线'))
    vi.mocked(accountApi.status).mockResolvedValue({
      loggedIn: false,
      sessionState: 'anonymous',
      syncEnabled: false,
    })
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

it('main-process cancellation preserves the current account without showing a failure', async () => {
  const cancelled = { code: 'CANCELLED', message: '已取消账号切换' }
  vi.mocked(accountApi.login).mockRejectedValueOnce(cancelled)
  vi.mocked(accountApi.register).mockRejectedValueOnce(cancelled)
  vi.mocked(accountApi.logout).mockRejectedValueOnce(cancelled)
  useAccountStore.setState({ status: loggedIn })
  await expect(useAccountStore.getState().login('email', 'password')).rejects.toEqual(cancelled)
  await expect(useAccountStore.getState().register('email', 'password', 't'.repeat(64))).rejects.toEqual(
    cancelled,
  )
  await useAccountStore.getState().logout()
  expect(accountApi.login).toHaveBeenCalledTimes(1)
  expect(accountApi.register).toHaveBeenCalledTimes(1)
  expect(accountApi.logout).toHaveBeenCalledTimes(1)
  expect(useAccountStore.getState().status).toEqual(loggedIn)
  expect(useAccountStore.getState().error).toBeNull()
})

it('displays normalized errors crossing contextBridge as plain failure DTOs', async () => {
  vi.mocked(accountApi.login).mockRejectedValueOnce({
    code: 'ACCOUNT_SETUP_REQUIRED',
    message: '账号服务尚未初始化',
  })
  await expect(useAccountStore.getState().login('u@example.com', 'password')).rejects.toBeDefined()
  expect(useAccountStore.getState().error).toBe('账号服务尚未初始化')
})
