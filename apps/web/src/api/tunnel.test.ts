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
import { beforeEach, expect, it, vi } from 'vitest'
import { tunnelApi } from './tunnel'
beforeEach(() => vi.clearAllMocks())
it('隧道管理通过空间内 IPC，不携带凭据', async () => {
  const config = {
    id: '',
    name: 'web',
    profile_id: 'p',
    kind: 'local' as const,
    bind_host: '::1',
    bind_port: 8080,
    target_host: 'example.com',
    target_port: 80,
  }
  await tunnelApi.save(config)
  await tunnelApi.start('one')
  await tunnelApi.stop('one')
  await tunnelApi.remove('one')
  expect(invoke.mock.calls).toEqual([
    ['tunnel.save', { config }],
    ['tunnel.start', { id: 'one' }],
    ['tunnel.stop', { id: 'one' }],
    ['tunnel.delete', { id: 'one' }],
  ])
})
