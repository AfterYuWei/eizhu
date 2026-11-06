const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/bridge', () => ({
  bridge: () =>
    new Proxy(
      {},
      {
        get: (_target, domain) =>
          new Proxy(
            {},
            {
              get: (_nested, method) => (input?: unknown) =>
                invoke(String(domain) + '.' + String(method), input),
            },
          ),
      },
    ),
}))
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { accountApi } from './account'

const mockedInvoke = vi.mocked(invoke)

beforeEach(() => mockedInvoke.mockReset())

describe('accountApi 领域接口', () => {
  it('登录态与账号同步全部通过领域化命令', async () => {
    mockedInvoke.mockResolvedValue(undefined)
    await accountApi.status()
    await accountApi.login('user@example.com', 'secret123')
    await accountApi.register('new@example.com', 'secret456', 'ticket')
    await accountApi.me()
    await accountApi.setSyncEnabled(false)
    await accountApi.logout()
    expect(mockedInvoke.mock.calls).toEqual([
      ['account.status', undefined],
      ['account.login', { email: 'user@example.com', password: 'secret123' }],
      ['account.register', { email: 'new@example.com', password: 'secret456', ticket: 'ticket' }],
      ['account.me', undefined],
      ['account.setSyncEnabled', { enabled: false }],
      ['account.logout', undefined],
    ])
  })
})
