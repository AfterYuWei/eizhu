import { payloadSchema } from '@eizhu/core/local/model'
import type { Payload, StoredProfile } from '@eizhu/core/local/model'

/** Public, synthetic credentials. Only accepted by the local development fixture. */
export const devMockLogin = { email: 'mock-sync@example.invalid', password: 'Mock-sync-2026!' }
export const devMockIds = {
  production: '10000000-0000-4000-8000-000000000001',
  development: '10000000-0000-4000-8000-000000000002',
  vault: '20000000-0000-4000-8000-000000000001',
  application: '30000000-0000-4000-8000-000000000001',
  cloudDeleted: '30000000-0000-4000-8000-000000000002',
  sameNameLocal: '30000000-0000-4000-8000-000000000003',
  localOnly: '30000000-0000-4000-8000-000000000004',
  hostTrust: '30000000-0000-4000-8000-000000000005',
  sameNameCloud: '30000000-0000-4000-8000-000000000006',
  cloudOnly: '30000000-0000-4000-8000-000000000007',
  offlineOnly: '30000000-0000-4000-8000-000000000008',
  snippetEdit: '40000000-0000-4000-8000-000000000001',
  snippetDeleted: '40000000-0000-4000-8000-000000000002',
} as const

export function devMockEnabled(requested: string | undefined, packaged: boolean, rendererUrl: string | undefined, smoke: boolean): boolean {
  if (requested !== '1') return false
  if (packaged || smoke || !rendererUrl) throw new Error('Mock data requires an unpackaged development renderer')
  const url = new URL(rendererUrl)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
    throw new Error('Mock data requires the local development renderer')
  return true
}

export function createDevMockData(): { offline: Payload; account: Payload; cloud: Payload } {
  const timestamp = '2026-11-04T00:00:00.000Z'
  const profile = (id: string, name: string, host: string): StoredProfile => ({
    id, name: `【MOCK】${name}`, host, port: 22, username: 'mock-deploy', auth_type: 'vault',
    vault_id: devMockIds.vault, group_id: devMockIds.production, tags: ['MOCK'],
    options: '', note: '合成示例，请勿用于真实连接', sort_order: 0, created_at: timestamp, updated_at: timestamp,
  })
  const account = payloadSchema.parse({
    groups: [
      { id: devMockIds.production, name: '【MOCK】生产环境 · 本机', icon: 'server', sort_order: 0, created_at: timestamp },
      { id: devMockIds.development, name: '【MOCK】开发环境', icon: 'folder', sort_order: 1, created_at: timestamp },
    ],
    vault: [{
      id: devMockIds.vault, name: '【MOCK】运维密码', type: 'password', username: 'mock-deploy',
      remark: '仅供本机模拟服务使用', fingerprint: '', credential: { password: 'mock-local-password' },
      created_at: timestamp, updated_at: timestamp,
    }],
    profiles: [
      { ...profile(devMockIds.application, '应用服务器', '192.0.2.12'), note: '本机修改：日志保留 14 天', tags: ['MOCK', '本机'] },
      profile(devMockIds.cloudDeleted, '云端已删除，本机仍保留', '192.0.2.20'),
      profile(devMockIds.sameNameLocal, '同名服务器', '198.51.100.10'),
      profile(devMockIds.localOnly, '仅本机存在', '192.0.2.30'),
      { ...profile(devMockIds.hostTrust, '指纹差异不冲突', '203.0.113.10'), options: JSON.stringify({ host_key_fingerprint: 'SHA256:public-mock-local-host-key' }) },
    ],
    snippets: [
      { id: devMockIds.snippetEdit, name: '【MOCK】查看日志', content: 'journalctl -n 200 --no-pager', description: '本机修改', tags: ['MOCK'], is_global: true, created_at: timestamp, updated_at: timestamp },
      { id: devMockIds.snippetDeleted, name: '【MOCK】本机删除，云端修改', content: 'journalctl --vacuum-time=7d', description: '待制造删除冲突', tags: ['MOCK'], is_global: true, created_at: timestamp, updated_at: timestamp },
    ],
  })
  const cloud = structuredClone(account)
  cloud.groups[0].name = '【MOCK】生产环境 · 云端'
  cloud.vault[0].credential = { password: 'mock-cloud-password' }
  cloud.profiles = [
    { ...account.profiles[0], name: '【MOCK】应用服务器 · 云端改名', host: '192.0.2.18', note: '云端修改：日志保留 7 天', tags: ['MOCK', '云端'] },
    profile(devMockIds.sameNameCloud, '同名服务器', '198.51.100.10'),
    profile(devMockIds.cloudOnly, '仅云端存在', '203.0.113.20'),
    { ...account.profiles[4], options: '{}' },
  ]
  cloud.snippets[0].content = 'journalctl -n 50 --no-pager'
  cloud.snippets[0].description = '云端修改'
  cloud.snippets[1].content = 'journalctl --vacuum-time=14d'
  cloud.snippets[1].description = '本机已删除，云端保留此修改'
  const offline = structuredClone(account)
  offline.groups[0].name = '【MOCK】离线空间'
  offline.profiles = [
    profile(devMockIds.offlineOnly, '离线专用服务器', '192.0.2.40'),
    structuredClone(account.profiles[0]),
    structuredClone(account.profiles[4]),
  ]
  return { offline, account, cloud }
}
