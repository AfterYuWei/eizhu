import { beforeEach, expect, it, vi } from 'vitest'
const { invokeCommand } = vi.hoisted(() => ({ invokeCommand: vi.fn() }))
vi.mock('./tauri', () => ({ invokeCommand }))
import { tunnelApi } from './tunnel'
beforeEach(() => vi.clearAllMocks())
it('隧道管理通过空间内 IPC，不携带凭据', async () => {
  const config = { id: '', name: 'web', profile_id: 'p', kind: 'local' as const, bind_host: '::1', bind_port: 8080, target_host: 'example.com', target_port: 80 }
  await tunnelApi.save(config); await tunnelApi.start('one'); await tunnelApi.stop('one'); await tunnelApi.remove('one')
  expect(invokeCommand.mock.calls).toEqual([['tunnel_save', { config }], ['tunnel_start', { id: 'one' }], ['tunnel_stop', { id: 'one' }], ['tunnel_delete', { id: 'one' }]])
})
