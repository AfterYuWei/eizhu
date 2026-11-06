import { test } from 'node:test'
import assert from 'node:assert/strict'
import { argon2Sync, hkdfSync, randomBytes } from 'node:crypto'
import { DesktopError } from '@eizhu/contracts'
import { masterCrypto, recoveryCredential, type MasterKeys } from './crypto.ts'
const parameters = {
  cryptoId: '11111111-1111-4111-8111-111111111111',
  salt: Buffer.alloc(16, 7).toString('base64'),
}
const password = '  synthetic 主密码 123  '

test('master authentication matches independent Node Argon2/HKDF and is purpose separated', async () => {
  const root = argon2Sync('argon2id', {
    message: password,
    nonce: Buffer.alloc(16, 7),
    parallelism: 2,
    tagLength: 32,
    memory: 65536,
    passes: 3,
  })
  const expected = Buffer.from(
    hkdfSync('sha256', root, parameters.cryptoId, 'eizhu:master:1:authentication', 32),
  )
  const wrapping = Buffer.from(
    hkdfSync('sha256', root, parameters.cryptoId, 'eizhu:master:1:key-wrapping', 32),
  )
  const derived = (await masterCrypto('master.credential', { password, parameters })) as {
    credential: string
  }
  assert.equal(derived.credential, 'gdGddWzbINNBEh3W9yX4e59+HNQXXg722k9x3m8ajiU=')
  assert.equal(derived.credential, expected.toString('base64'))
  assert.notEqual(derived.credential, wrapping.toString('base64'))
  assert.notEqual(
    (
      (await masterCrypto('master.credential', { password: password.trim(), parameters })) as {
        credential: string
      }
    ).credential,
    derived.credential,
  )
  root.fill(0)
  expected.fill(0)
  wrapping.fill(0)
})
test('master password rotation preserves the data key and device recovery credential', async () => {
  const created = (await masterCrypto('master.create', { password, parameters })) as {
    key: Uint8Array
    keys: MasterKeys
    recoveryHash: string
    credential: string
  }
  const old = Buffer.from(created.key)
  const recovery = recoveryCredential(old, parameters.cryptoId)
  const rotated = (await masterCrypto('master.create', {
    password: 'new-master-password',
    parameters: { ...parameters, salt: randomBytes(16).toString('base64') },
    keys: { ...created.keys, revision: 1 },
    key: Buffer.from(old),
  })) as typeof created
  assert.notEqual(rotated.credential, created.credential)
  assert.equal(rotated.recoveryHash, created.recoveryHash)
  assert.equal(recoveryCredential(rotated.key, parameters.cryptoId), recovery)
  const opened = (await masterCrypto('master.open', {
    password: 'new-master-password',
    keys: rotated.keys,
  })) as { key: Uint8Array }
  assert.deepEqual(Buffer.from(opened.key), old)
  await assert.rejects(
    masterCrypto('master.open', { password, keys: rotated.keys }),
    (e) => e instanceof DesktopError && e.error.code === 'SYNC_CRYPTO',
  )
  await assert.rejects(
    masterCrypto('master.open', {
      password: 'new-master-password',
      keys: { ...rotated.keys, cryptoId: '22222222-2222-4222-8222-222222222222' },
    }),
  )
  opened.key.fill(0)
  created.key.fill(0)
  rotated.key.fill(0)
  old.fill(0)
})
