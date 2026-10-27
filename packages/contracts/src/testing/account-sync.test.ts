import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  account,
  accountStatusSchema,
  sync,
  syncConflictSchema,
  syncCapabilitiesSchema,
  syncPushSchema,
  eventSchemas,
} from '../index.ts'

const user = {
  id: 42,
  email: 'user@example.invalid',
  storageUsed: 0,
  storageQuota: 1024,
  emailVerified: false,
  verificationRequired: true,
}
test('account schemas reject unsafe identities, leaked tokens and contradictory session states', () => {
  const value = { loggedIn: true, sessionState: 'reauth_required', user, syncEnabled: true }
  assert.equal(accountStatusSchema.safeParse(value).success, true)
  for (const invalid of [
    { ...value, accessToken: 'secret' },
    { ...value, user: { ...user, id: Number.MAX_SAFE_INTEGER + 1 } },
    { ...value, user: undefined },
    { ...value, sessionState: 'anonymous' },
    { loggedIn: false, sessionState: 'anonymous', syncEnabled: true },
  ])
    assert.equal(accountStatusSchema.safeParse(invalid).success, false)
  assert.equal(
    account['account.register'].input.safeParse({ email: user.email, password: '中'.repeat(25) }).success,
    false,
  )
  assert.equal(
    account['account.register'].input.safeParse({ email: user.email, password: '中'.repeat(24) }).success,
    true,
  )
  assert.equal(account['account.verifyEmail'].input.safeParse({ code: '12345x' }).success, false)
  assert.equal(
    account['account.login'].input.parse({ email: user.email, password: '  原样密码🔐  ' }).password,
    '  原样密码🔐  ',
  )
})

test('sync boundaries reject secret summaries, unsafe cursors and unbound replacement writes', () => {
  const conflict = {
    itemType: 'profile',
    itemId: 'p',
    name: 'server',
    reason: 'concurrent_edit',
    remoteRevision: 1,
    localDeleted: false,
    remoteDeleted: false,
    local: { name: 'server', credential_changed: true },
  }
  assert.equal(syncConflictSchema.safeParse(conflict).success, true)
  for (const field of ['password', 'private_key', 'passphrase', 'proxy_password', 'options', 'accessToken'])
    assert.equal(syncConflictSchema.safeParse({ ...conflict, local: { [field]: 'secret' } }).success, false)
  assert.equal(
    syncCapabilitiesSchema.safeParse({
      protocol: 2,
      seq: Number.MAX_SAFE_INTEGER + 1,
      epoch: 1,
      keysReady: false,
    }).success,
    false,
  )
  assert.equal(
    syncCapabilitiesSchema.safeParse({ protocol: 1, seq: 0, epoch: 1, keysReady: false }).success,
    false,
  )
  const push = {
    requestId: randomUUID(),
    deviceId: randomUUID(),
    epoch: 1,
    replace: true,
    expectedSeq: null,
    items: [],
  }
  assert.equal(syncPushSchema.safeParse(push).success, false)
  assert.equal(syncPushSchema.safeParse({ ...push, expectedSeq: 0 }).success, true)
  assert.equal(
    sync['sync.preview'].input.safeParse({ includeOffline: true, filePath: '/tmp/other' }).success,
    false,
  )
  assert.equal(
    eventSchemas['eizhu-sync-message'].safeParse({ workspaceGeneration: 1, status: {} }).success,
    false,
  )
})
