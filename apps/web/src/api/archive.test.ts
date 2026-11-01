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
  it('自动备份和目录选择使用独立领域接口', async () => {
    mockedInvoke.mockResolvedValue(undefined)
    await archiveApi.status()
    await archiveApi.backupNow()
    await archiveApi.selectDirectory()
    expect(mockedInvoke.mock.calls).toEqual([
      ['backup.status', undefined], ['backup.backupNow', undefined], ['backup.selectDirectory', undefined],
    ])
  })

  it('设置密码作为独立敏感参数传递', async () => {
    mockedInvoke.mockResolvedValue(undefined)
    const settings: BackupSettings = {
      directory: '/selected/backup',
      scheduled_enabled: false,
      scheduled_interval_hours: 0,
      scheduled_daily_time: '',
      auto_backup_enabled: true,
      change_debounce_seconds: 30,
      backup_password_set: false,
    }

    await archiveApi.settings()
    await archiveApi.updateSettings(settings, 'secret')

    expect(mockedInvoke.mock.calls).toEqual([
      ['backup.getSettings', undefined],
      ['backup.updateSettings', { settings: { scheduled_enabled: false, scheduled_interval_hours: 0, scheduled_daily_time: '', auto_backup_enabled: true, change_debounce_seconds: 30 }, backupPassword: 'secret' }],
    ])
  })

  it('provider 与 OAuth 使用领域接口', async () => {
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
