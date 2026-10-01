import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { archiveApi } from './archive'
import type { ProviderConfig, BackupSettings } from '@/types/backup'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const mockedInvoke = vi.mocked(invoke)

beforeEach(() => mockedInvoke.mockReset())

describe('archiveApi Rust commands', () => {
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
      ['backup_status', undefined],
      ['backup_backup_now', undefined],
      ['backup_versions', undefined],
      ['backup_restore_version', { id: 'v1' }],
      ['backup_delete_version', { id: 'v1', force: true }],
      ['backup_events', { limit: 25 }],
      ['backup_submit_latest', undefined],
      ['backup_push', undefined],
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
      ['backup_get_settings', undefined],
      ['backup_update_settings', { settings, backupPassword: 'secret' }],
      ['backup_reveal_password', undefined],
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
      ['backup_targets', undefined],
      ['backup_create_provider', { config }],
      ['backup_update_provider', { id: 'p1', config }],
      ['backup_test_provider', { id: 'p1' }],
      ['backup_oauth_url', { providerType: 'gdrive', providerId: 'p1' }],
      ['backup_delete_provider', { id: 'p1' }],
    ])
  })
})
