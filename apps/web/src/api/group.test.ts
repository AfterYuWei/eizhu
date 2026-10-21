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
import { groupApi } from './group'

const mockedInvoke = vi.mocked(invoke)

beforeEach(() => mockedInvoke.mockReset())

describe('groupApi', () => {
  it('通过领域化 Tauri command 执行 CRUD', async () => {
    mockedInvoke.mockResolvedValueOnce([])
    await expect(groupApi.list()).resolves.toEqual([])
    expect(mockedInvoke).toHaveBeenLastCalledWith('group.list', undefined)

    const request = { name: '生产' }
    mockedInvoke.mockResolvedValueOnce({ id: 'g1', ...request })
    await groupApi.create(request)
    expect(mockedInvoke).toHaveBeenLastCalledWith('group.create', { request })

    mockedInvoke.mockResolvedValueOnce({ id: 'g1', name: '测试' })
    await groupApi.update('g1', { name: '测试' })
    expect(mockedInvoke).toHaveBeenLastCalledWith('group.update', {
      id: 'g1',
      request: { name: '测试' },
    })

    mockedInvoke.mockResolvedValueOnce(undefined)
    await groupApi.delete('g1')
    expect(mockedInvoke).toHaveBeenLastCalledWith('group.delete', { id: 'g1' })
  })
})
