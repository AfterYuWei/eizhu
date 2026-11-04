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
it('对外启动只携带用户确认的映射快照，不保存启动授权', async () => {
  const config = { id: 'public', name: '公开服务', profile_id: 'p', kind: 'remote' as const, bind_host: '0.0.0.0', bind_port: 9000, target_host: '127.0.0.1', target_port: 3000 }
  await tunnelApi.start(config.id, config)
  expect(invoke).toHaveBeenCalledWith('tunnel.start', { id: config.id, confirmedConfig: config })
  expect(invoke).toHaveBeenCalledTimes(1)
})
