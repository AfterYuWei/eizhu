// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { AccountEmailForm } from './AccountEmailForm'
import { accountApi } from '@/api/account'

vi.mock('@/api/account', () => ({ accountApi: { sendVerificationEmail: vi.fn(), verifyEmail: vi.fn(), requestPasswordReset: vi.fn(), resetPassword: vi.fn() } }))
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('keeps verification input available after a rejected or expired code', async () => {
  vi.mocked(accountApi.verifyEmail).mockRejectedValue({ error: { message: '验证码无效或已过期，请重新获取' } })
  const complete = vi.fn()
  await act(async () => root.render(<AccountEmailForm purpose="verify" email="u@example.com" onComplete={complete} />))
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('验证码无效或已过期')
  expect(host.querySelector('input[autocomplete="one-time-code"]')).not.toBeNull()
  expect(complete).not.toHaveBeenCalled()
})

it('shares a submission lock and completes verification only after the server accepts it', async () => {
  let finish!: () => void
  vi.mocked(accountApi.verifyEmail).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
  const complete = vi.fn()
  await act(async () => root.render(<AccountEmailForm purpose="verify" email="u@example.com" onComplete={complete} />))
  await act(async () => {
    const form = host.querySelector('form')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(accountApi.verifyEmail).toHaveBeenCalledTimes(1)
  expect(complete).not.toHaveBeenCalled()
  await act(async () => finish())
  expect(complete).toHaveBeenCalledTimes(1)
})

it('limits mail resends and explains encrypted passwords are independent of login recovery', async () => {
  vi.mocked(accountApi.requestPasswordReset).mockResolvedValue(undefined)
  await act(async () => root.render(<AccountEmailForm purpose="reset" email="u@example.com" onComplete={() => undefined} />))
  const send = [...host.querySelectorAll('button')].find((node) => node.textContent === '发送验证码')!
  await act(async () => send.click())
  await act(async () => send.click())
  expect(accountApi.requestPasswordReset).toHaveBeenCalledTimes(1)
  expect(host.textContent).toContain('无法恢复同步密码、备份密码')
})
