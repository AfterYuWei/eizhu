import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { accountApi } from './account'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const mockedInvoke = vi.mocked(invoke)

beforeEach(() => mockedInvoke.mockReset())

describe('accountApi Rust commands', () => {
  it('登录态与账号同步全部通过领域化命令', async () => {
    mockedInvoke.mockResolvedValue(undefined)
    await accountApi.status()
    await accountApi.login('user@example.com', 'secret123')
    await accountApi.register('new@example.com', 'secret456')
    await accountApi.me()
    await accountApi.setSyncEnabled(false)
    await accountApi.logout()
    expect(mockedInvoke.mock.calls).toEqual([
      ['account_status', undefined],
      ['account_login', { email: 'user@example.com', password: 'secret123' }],
      ['account_register', { email: 'new@example.com', password: 'secret456' }],
      ['account_me', undefined],
      ['account_set_sync_enabled', { enabled: false }],
      ['account_logout', undefined],
    ])
  })
})
