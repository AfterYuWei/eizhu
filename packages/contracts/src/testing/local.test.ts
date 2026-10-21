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
