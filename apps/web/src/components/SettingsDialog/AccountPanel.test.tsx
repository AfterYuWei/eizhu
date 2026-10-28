// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AccountPanel } from './AccountPanel'
import { AccountDialog } from './AccountDialog'
import { useAccountDialogStore } from '@/store/accountDialog'
import { useAccountStore } from '@/store/account'
import { accountApi } from '@/api/account'
import type { AccountStatus } from '@/types/account'
vi.mock('@/lib/workspace', () => ({ refreshWorkspace: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/store/sync', () => ({
  useSyncStore: { getState: () => ({ refresh: vi.fn().mockResolvedValue(undefined) }) },
}))
vi.mock('@/api/account', () => ({
  accountApi: {
    status: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    setSyncEnabled: vi.fn(),
    requestRegistrationCode: vi.fn(),
    verifyRegistrationCode: vi.fn(),
    recoveryAvailable: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    changePassword: vi.fn(),
  },
}))
let host: HTMLDivElement, root: Root
const signedIn: AccountStatus = {
  loggedIn: true,
  sessionState: 'authenticated',
  syncEnabled: false,
  user: {
    id: 42,
    email: 'u@example.invalid',
    storageUsed: 0,
    storageQuota: 1024,
    emailVerified: true,
    verificationRequired: true,
  },
}
beforeEach(async () => {
  vi.resetAllMocks()
  useAccountStore.setState(useAccountStore.getInitialState(), true)
  useAccountDialogStore.getState().close()
  vi.mocked(accountApi.requestRegistrationCode).mockResolvedValue({
    challengeId: '22222222-2222-4222-8222-222222222222',
    retryAfterSeconds: 60,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  })
  vi.mocked(accountApi.verifyRegistrationCode).mockResolvedValue({ ticket: 't'.repeat(64) })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root.render(
      <>
        <AccountPanel />
        <AccountDialog />
      </>,
    ),
  )
})
afterEach(async () => {
  await act(async () => {
    root.unmount()
    useAccountDialogStore.getState().close()
  })
  host.remove()
})
async function fill(selector: string, value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>(selector)!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const submit = () =>
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
const click = async (label: string) =>
  act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === label)!.click())
it('requires verified registration before asking for a master password and retains rejected input', async () => {
  await click('创建账号')
  expect(document.querySelector('#account-password')).toBeNull()
  await fill('#account-email', 'u@example.invalid')
  await act(async () => {
    submit()
  })
  expect(accountApi.register).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('60 秒后重发')
  await fill('#account-code', '000000')
  vi.mocked(accountApi.verifyRegistrationCode).mockRejectedValueOnce(new Error('验证码无效或已过期'))
  await act(async () => {
    submit()
  })
  expect(document.body.textContent).toContain('验证码无效或已过期')
  expect(document.querySelector('#account-password')).toBeNull()
  await fill('#account-code', '123456')
  await act(async () => {
    submit()
  })
  await fill('#account-password', 'temporary-master')
  await fill('#account-confirm', 'different')
  await act(async () => {
    submit()
  })
  expect(accountApi.register).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('两次输入的主密码不一致')
  await fill('#account-confirm', 'temporary-master')
  vi.mocked(accountApi.register).mockRejectedValueOnce(new Error('该邮箱已被注册'))
  await act(async () => {
    submit()
  })
  expect(accountApi.register).toHaveBeenCalledWith('u@example.invalid', 'temporary-master', 't'.repeat(64))
  expect(document.querySelector<HTMLInputElement>('#account-password')!.value).toBe('temporary-master')
  expect(JSON.stringify(useAccountStore.getState())).not.toContain('temporary-master')
  vi.mocked(accountApi.register).mockRejectedValueOnce({ code: 'INVALID_EMAIL_CODE', message: '注册凭证已过期，请重新验证邮箱' })
  await act(async () => { submit() })
  expect(document.querySelector('#account-code')).not.toBeNull()
  expect(document.querySelector('#account-password')).toBeNull()
  expect(document.body.textContent).toContain('u@example.invalid')
})
it('locks duplicate login submissions and closes only after accepted login', async () => {
  await click('登录')
  let finish!: (status: AccountStatus) => void
  vi.mocked(accountApi.login).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await fill('#account-email', 'u@example.invalid')
  await fill('#account-password', 'temporary-master')
  await act(async () => {
    submit()
    submit()
  })
  expect(accountApi.login).toHaveBeenCalledTimes(1)
  await act(async () => finish(signedIn))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(host.textContent).toContain('已登录')
  expect(accountApi.setSyncEnabled).not.toHaveBeenCalled()
})
it('does not treat cancelled workspace confirmation as successful login', async () => {
  await click('登录')
  vi.mocked(accountApi.login).mockRejectedValue({ code: 'CANCELLED', message: '已取消账号切换' })
  await fill('#account-email', 'u@example.invalid')
  await fill('#account-password', 'temporary-master')
  await act(async () => {
    submit()
  })
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(document.querySelector<HTMLInputElement>('#account-password')!.value).toBe('temporary-master')
})
it('blocks email-only recovery before sending mail on an unavailable device', async () => {
  await click('登录')
  await click('忘记主密码？')
  await fill('#account-email', 'u@example.invalid')
  vi.mocked(accountApi.recoveryAvailable).mockResolvedValue(false)
  await act(async () => {
    submit()
  })
  expect(accountApi.requestPasswordReset).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('所有设备都无法解锁')
})
it('keeps account identity and local-data explanation during reauthentication', async () => {
  await act(async () =>
    useAccountStore.setState({ status: { ...signedIn, sessionState: 'reauth_required' } }),
  )
  expect(host.textContent).toContain('账号空间和本地修改仍保留')
  expect(host.textContent).toContain('确认前不上传本地条目')
  await click('重新登录')
  expect(document.querySelector<HTMLInputElement>('#account-email')!.value).toBe(signedIn.user.email)
})
