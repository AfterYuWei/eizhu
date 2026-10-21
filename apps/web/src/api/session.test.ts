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

import { sessionApi } from './session'

describe('sessionApi', () => {
  beforeEach(() => invoke.mockReset())

  it('creates and closes sessions through fine-grained 领域接口', async () => {
    invoke.mockResolvedValue(undefined)
    const request = { profile_id: 'p1', cols: 120, rows: 40 }
    await sessionApi.create(request)
    await sessionApi.close('s1')
    expect(invoke).toHaveBeenNthCalledWith(1, 'session.create', { request })
    expect(invoke).toHaveBeenNthCalledWith(2, 'session.close', { id: 's1' })
  })

  it('routes terminal I/O and completion through 领域接口', async () => {
    invoke.mockResolvedValue(undefined)
    await sessionApi.input('s1', 'ls\r')
    await sessionApi.resize('s1', 100, 30)
    await sessionApi.complete('s1', 'r1', { generatorId: 'git-branches', params: {} }, '/tmp')
    expect(invoke).toHaveBeenNthCalledWith(1, 'session.input', {
      id: 's1',
      data: 'ls\r',
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'session.resize', {
      id: 's1',
      cols: 100,
      rows: 30,
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'session.complete', {
      id: 's1',
      requestId: 'r1',
      generatorId: 'git-branches',
      params: {},
      cwd: '/tmp',
    })
  })
})
