// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AccountPanel } from './AccountPanel'
import { useAccountStore } from '@/store/account'
import { accountApi } from '@/api/account'
import type { AccountStatus } from '@/types/account'

vi.mock('@/lib/workspace', () => ({ refreshWorkspace: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/api/account', () => ({ accountApi: {
  status: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn(), me: vi.fn(), setSyncEnabled: vi.fn(),
  sendVerificationEmail: vi.fn(), verifyEmail: vi.fn(), requestPasswordReset: vi.fn(), resetPassword: vi.fn(),
} }))
let host: HTMLDivElement, root: Root
const signedIn: AccountStatus = { loggedIn: true, sessionState: 'authenticated', syncEnabled: false, user: { id: 42, email: 'u@example.invalid', storageUsed: 0, storageQuota: 1024, emailVerified: false, verificationRequired: true } }
beforeEach(async () => {
  vi.resetAllMocks()
  useAccountStore.setState(useAccountStore.getInitialState(), true)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<AccountPanel />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function fill(selector: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(selector)!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const submit = () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

it('validates confirmation before registration and retains the form after a normalized rejection', async () => {
  await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === '注册')!.click())
  await fill('#account-email', 'u@example.invalid'); await fill('#account-password', 'synthetic123'); await fill('#account-confirm', 'different')
  await act(async () => { submit() })
  expect(accountApi.register).not.toHaveBeenCalled()
  expect(host.textContent).toContain('两次输入的密码不一致')
  await fill('#account-confirm', 'synthetic123')
  vi.mocked(accountApi.register).mockRejectedValue({ code: 'ACCOUNT_EMAIL_TAKEN', message: '该邮箱已被注册' })
  await act(async () => { submit() })
  expect(accountApi.register).toHaveBeenCalledWith('u@example.invalid', 'synthetic123')
  expect(host.textContent).toContain('该邮箱已被注册')
  expect(host.querySelector<HTMLInputElement>('#account-password')?.value).toBe('synthetic123')
  expect(JSON.stringify(useAccountStore.getState())).not.toContain('synthetic123')
})

it('locks duplicate submissions and clears credential inputs after the account accepts login', async () => {
  let finish!: (status: AccountStatus) => void
  vi.mocked(accountApi.login).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  await fill('#account-email', 'u@example.invalid'); await fill('#account-password', 'synthetic123')
  await act(async () => { submit(); submit() })
  expect(accountApi.login).toHaveBeenCalledTimes(1)
  await act(async () => finish(signedIn))
  expect(host.querySelector('input[type="password"]')).toBeNull()
  expect(host.textContent).toContain('已登录')
  expect(host.textContent).toContain('待接入')
  expect(accountApi.setSyncEnabled).not.toHaveBeenCalled()
})

it('retains account identity while requesting reauthentication and explains deferred item sync', async () => {
  await act(async () => useAccountStore.setState({ status: { ...signedIn, sessionState: 'reauth_required' } }))
  expect(host.textContent).toContain('账号空间和本地修改仍保留')
  expect([...host.querySelectorAll('button')].some((button) => button.textContent === '重新登录')).toBe(true)
  expect(host.textContent).toContain('当前不上传本地数据')
})
