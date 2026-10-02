import { expect, it } from 'vitest'
import { backupDiagnostic, conflictDependencies, recoveryFor, restoreSourceLabel, syncDiagnostic } from './syncExperience'
import type { BackupStatus } from '@/types/backup'
import type { SyncConflict, SyncStatus } from '@/types/sync'
it('routes authentication, encryption, quota and network errors to distinct actions', () => {
  expect(recoveryFor('ACCOUNT_NOT_LOGGED_IN').kind).toBe('account')
  expect(recoveryFor('', 'locked').kind).toBe('unlock')
  expect(recoveryFor('ACCOUNT_QUOTA_EXCEEDED').kind).toBe('quota')
  expect(recoveryFor('', 'offline').kind).toBe('network')
  expect(recoveryFor('UNKNOWN').kind).toBe('retry')
})
it('uses the actual restore source and excludes backup names and error bodies from diagnostics', () => {
  expect(restoreSourceLabel({ kind: 'cloud', providerName: '家用云', object: 'v001.eizhubackup' })).toBe('云端备份：家用云 · v001.eizhubackup')
  expect(restoreSourceLabel({ kind: 'safety', createdAt: '2026-10-02' })).not.toContain('v0')
  const report = backupDiagnostic({ status: 'error', local_latest: null, last_sync_at: null, providers: [{ id: 'private-id', type: 'webdav', name: 'private-name', enabled: true }] } as BackupStatus, [{ id: 'private-id', provider_id: 'private-id', action: 'push', version: 3, success: false, error: 'secret token', created_at: '' }])
  for (const value of ['private-id', 'private-name', 'secret', 'token']) expect(report).not.toContain(value)
})
it('deduplicates dependency targets without copying credential fields', () => {
  expect(conflictDependencies({ local: { group_id: 'g', vault_id: 'v', password: 'secret' }, remote: { group_id: 'g', jump_profile_id: 'p' } } as unknown as SyncConflict)).toEqual([{ type: 'group', id: 'g' }, { type: 'vault', id: 'v' }, { type: 'profile', id: 'p' }])
})
it('diagnostics contain only explicitly allowed state metadata', () => {
  const report = syncDiagnostic({ status: 'error', pendingCount: 1, conflictCount: 0, initialized: true, unlocked: false, cursor: 5, lastConfirmed: null, lastErrorCode: 'SYNC_LOCKED', lastError: 'secret token response', items: [{ itemId: 'private-id', name: 'private-name', itemType: 'snippet', status: 'pending', generation: 2, deleted: false }], password: 'secret' } as unknown as SyncStatus)
  for (const secret of ['private-id', 'private-name', 'secret', 'password']) expect(report).not.toContain(secret)
  expect(JSON.parse(report).sync.itemStates).toEqual({ pending: 1 })
})
