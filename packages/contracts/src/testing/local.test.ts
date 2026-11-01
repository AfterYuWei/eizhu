import { test } from 'node:test'
import assert from 'node:assert/strict'
import { local, isLocalOperation } from '../index.ts'

test('stage 2 exposes local domains while SSH, accounts and cloud remain reserved', () => {
  for (const name of ['profile.create', 'vault.reveal', 'backup.preview', 'audit.list', 'document.pick'])
    assert.equal(isLocalOperation(name), true)
  for (const name of ['session.create', 'account.login', 'backup.createProvider', 'database.query'])
    assert.equal(isLocalOperation(name), false)
  const base = { name: '', host: 'example.invalid', username: 'root', auth_type: 'agent' }
  for (const port of [0, -1, 65536, 22.5])
    assert.equal(local['profile.create'].input.safeParse({ request: { ...base, port } }).success, false)
  assert.equal(
    local['profile.create'].input.safeParse({ request: { ...base, sql: 'ignored?' } }).success,
    false,
  )
  assert.equal(
    local['vault.generateKeyPair'].input.safeParse({ request: { algo: 'rsa', bits: 1024 } }).success,
    false,
  )
  assert.equal(
    local['localState.write'].input.safeParse({
      key: 'history_settings',
      value: { enabled: true, maxEntries: 0, retentionDays: 30 },
    }).success,
    false,
  )
  assert.equal(
    local['localState.write'].input.safeParse({ key: 'shortcuts', value: { secret: 'x'.repeat(129) } })
      .success,
    false,
  )
})
test('list output schemas reject leaked credentials and invalid restore sources', () => {
  const vault = {
    id: 'v',
    name: '凭据',
    type: 'password',
    username: 'root',
    remark: '',
    fingerprint: '',
    ref_count: 0,
    has_passphrase: false,
    created_at: '',
    updated_at: '',
  }
  assert.equal(local['vault.list'].output.safeParse([vault]).success, true)
  assert.equal(local['vault.list'].output.safeParse([{ ...vault, password: 'synthetic' }]).success, false)
  assert.equal(
    local['document.readText'].input.safeParse({ reference: 'ref', maxBytes: 1024 * 1024 + 1 }).success,
    false,
  )
})

test('sidebar folder preferences accept only bounded group IDs and boolean states', () => {
  assert.equal(local['localState.read'].input.safeParse({ key: 'sidebar_groups' }).success, true)
  for (const value of [{ parent: true, child: false }, {}])
    assert.equal(local['localState.write'].input.safeParse({ key: 'sidebar_groups', value }).success, true)
  for (const value of [{ parent: 'true' }, { '': true }, { ['x'.repeat(161)]: true }, []])
    assert.equal(local['localState.write'].input.safeParse({ key: 'sidebar_groups', value }).success, false)
})

test('removed restore history APIs are unavailable and directory selection never accepts renderer paths', () => {
  for (const op of ['backup.safetyVersions', 'backup.previewSafety', 'backup.applyRestore', 'backup.prepareRestore'])
    assert.equal(isLocalOperation(op), false)
  assert.equal(local['backup.selectDirectory'].input.safeParse(undefined).success, true)
  assert.equal(local['backup.selectDirectory'].input.safeParse({ directory: '/untrusted' }).success, false)
})
