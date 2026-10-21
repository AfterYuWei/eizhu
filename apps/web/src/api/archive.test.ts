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
import { archiveApi } from './archive'
import type { ProviderConfig, BackupSettings } from '@/types/backup'

const mockedInvoke = vi.mocked(invoke)

beforeEach(() => mockedInvoke.mockReset())

describe('archiveApi 领域接口', () => {
  it('版本、状态、事件和同步动作全部通过细粒度 command', async () => {
    mockedInvoke.mockResolvedValue(undefined)

    await archiveApi.status()
    await archiveApi.backupNow()
    await archiveApi.versions()
    await archiveApi.restoreVersion('v1')
    await archiveApi.deleteVersion('v1', true)
    await archiveApi.events(25)
    await archiveApi.syncNow()
    await archiveApi.push()

    expect(mockedInvoke.mock.calls).toEqual([
      ['backup.status', undefined],
      ['backup.backupNow', undefined],
      ['backup.versions', undefined],
      ['backup.restoreVersion', { id: 'v1' }],
      ['backup.deleteVersion', { id: 'v1', force: true }],
      ['backup.events', { limit: 25 }],
      ['backup.submitLatest', undefined],
      ['backup.push', undefined],
    ])
  })

  it('设置密码作为独立敏感参数传递', async () => {
    mockedInvoke.mockResolvedValue(undefined)
    const settings: BackupSettings = {
      sync_mode: 'auto',
      conflict_policy: 'prompt',
      cloud_retention: 'keep_forever',
      local_keep_versions: 20,
      scheduled_enabled: false,
      scheduled_interval_hours: 0,
      scheduled_daily_time: '',
      auto_backup_enabled: true,
      change_debounce_seconds: 30,
      backup_password_set: false,
    }

    await archiveApi.settings()
    await archiveApi.updateSettings(settings, 'secret')
    await archiveApi.revealPassword()

    expect(mockedInvoke.mock.calls).toEqual([
      ['backup.getSettings', undefined],
      ['backup.updateSettings', { settings, backupPassword: 'secret' }],
      ['backup.revealPassword', undefined],
    ])
  })

  it('provider 与 OAuth 使用 Rust command 和原生深链参数', async () => {
    mockedInvoke.mockResolvedValue(undefined)
    const config: ProviderConfig = {
      type: 'gdrive',
      name: 'Drive',
      enabled: true,
      oauth_client_id: 'client',
    }

    await archiveApi.providers()
    await archiveApi.createProvider(config)
    await archiveApi.updateProvider('p1', config)
    await archiveApi.testProvider('p1')
    await archiveApi.oauthURL('gdrive', 'p1')
    await archiveApi.deleteProvider('p1')

    expect(mockedInvoke.mock.calls).toEqual([
      ['backup.targets', undefined],
      ['backup.createProvider', { config }],
      ['backup.updateProvider', { id: 'p1', config }],
      ['backup.testProvider', { id: 'p1' }],
      ['backup.oauthUrl', { providerType: 'gdrive', providerId: 'p1' }],
      ['backup.deleteProvider', { id: 'p1' }],
    ])
  })
})
