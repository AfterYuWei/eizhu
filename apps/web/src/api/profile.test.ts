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
import { profileApi } from './profile'

const mockedInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockedInvoke.mockReset()
})

describe('profileApi', () => {
  it('持久化 CRUD 仅通过领域化 领域接口', async () => {
    mockedInvoke.mockResolvedValue(undefined)
    await profileApi.list({ group_id: 'g1', search: '生产' })
    expect(mockedInvoke).toHaveBeenLastCalledWith('profile.list', {
      groupId: 'g1',
      search: '生产',
    })

    await profileApi.get('p1')
    expect(mockedInvoke).toHaveBeenLastCalledWith('profile.get', { id: 'p1' })

    const request = {
      name: 'web',
      host: 'example.com',
      username: 'root',
      auth_type: 'password' as const,
      password: 'secret',
    }
    await profileApi.create(request)
    expect(mockedInvoke).toHaveBeenLastCalledWith('profile.create', { request })

    await profileApi.update('p1', { note: '生产' })
    expect(mockedInvoke).toHaveBeenLastCalledWith('profile.update', {
      id: 'p1',
      request: { note: '生产' },
    })

    await profileApi.delete('p1')
    expect(mockedInvoke).toHaveBeenLastCalledWith('profile.delete', { id: 'p1' })
  })

  it('SSH 连接测试与 host-key 确认通过 领域接口', async () => {
    mockedInvoke.mockResolvedValue(undefined)
    const draft = {
      name: 'web',
      host: 'example.com',
      username: 'root',
      auth_type: 'agent' as const,
    }
    await profileApi.testNew(draft)
    expect(mockedInvoke).toHaveBeenLastCalledWith('profile.testNew', { request: draft })

    await profileApi.test('p1', { host: 'new.example.com' })
    expect(mockedInvoke).toHaveBeenLastCalledWith('profile.testExisting', {
      id: 'p1',
      request: { host: 'new.example.com' },
    })

    await profileApi.confirmHostKey('p1', 'SHA256:test')
    expect(mockedInvoke).toHaveBeenLastCalledWith('profile.confirmHostKey', {
      id: 'p1',
      fingerprint: 'SHA256:test',
    })
  })
})
