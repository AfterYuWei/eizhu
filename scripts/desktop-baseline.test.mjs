import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { baselineDirectory, decrypt, deriveBackupKey, readJson, resolveAsset, validateCoverage, verifyBaseline } from './verify-desktop-baseline.mjs'
import { collectLegacyInventory } from './desktop-baseline-inventory.mjs'
import { fileURLToPath } from 'node:url'

test('frozen source, UI assets and original Rust backup/sync vectors verify independently in Node', async () => {
  const result = await verifyBaseline(baselineDirectory, { checkSource: true })
  assert.equal(result.backupFiles, 7)
  assert.equal(result.rejectedBackupFiles, 10)
  assert.equal(result.syncItems, 2)
  assert.equal(result.browserScreenshots, 10)
  assert.equal(result.nativeEvidence, 'pending')
})

test('wrong password, format AAD and modified authentication tags reject original exporter ciphertext', async () => {
  const file = await readJson(path.join(baselineDirectory, 'eizhu-encrypted.eizhubackup'))
  const vectors = await readJson(path.join(baselineDirectory, 'backup-vectors.json'))
  const key = await deriveBackupKey(file.kdf, vectors.vectors[0].password)
  const wrong = await deriveBackupKey(file.kdf, 'wrong-password')
  try {
    assert.throws(() => decrypt(wrong, file.payload, 'eizhu-backup:1'))
    assert.throws(() => decrypt(key, file.payload, 'xcontrol-backup:1'))
    const damaged = Buffer.from(file.payload, 'base64'); damaged[damaged.length - 1] ^= 1
    assert.throws(() => decrypt(key, damaged.toString('base64'), 'eizhu-backup:1'))
  } finally { key.fill(0); wrong.fill(0) }
})

test('sync ciphertext is bound to user, type, ID, revision, epoch, key version and deletion', async () => {
  const fixture = await readJson(path.join(baselineDirectory, 'sync-v2-vectors.json'))
  const key = Buffer.from(fixture.dataKeyHex, 'hex')
  try {
    for (const item of fixture.items) {
      const aad = JSON.parse(item.aadUtf8)
      for (const index of [2, 3, 4, 5, 6, 7, 8]) {
        const changed = [...aad]
        changed[index] = typeof changed[index] === 'number' ? changed[index] + 1 : typeof changed[index] === 'boolean' ? !changed[index] : `${changed[index]}-other`
        assert.throws(() => decrypt(key, item.ciphertext, JSON.stringify(changed)))
      }
    }
  } finally { key.fill(0) }
})

test('encrypted OpenSSH specimen contains a real password-protected private key and dependency graph', async () => {
  const payload = await readJson(path.join(baselineDirectory, 'payload-plain.json'))
  const vault = payload.vault.find(item => item.type === 'private_key')
  const key = Buffer.from(vault.credential.private_key.split('\n').filter(line => !line.startsWith('---')).join(''), 'base64')
  assert.equal(key.subarray(0, 15).toString(), 'openssh-key-v1\0')
  const cipherLength = key.readUInt32BE(15)
  assert.notEqual(key.subarray(19, 19 + cipherLength).toString(), 'none')
  assert.ok(vault.credential.passphrase.includes('fixture-only'))
  const jump = payload.profiles.find(item => item.id === 'profile-jump')
  assert.equal(jump.vault_id, vault.id)
  assert.equal(JSON.parse(jump.options).proxy.jump_profile_id, 'profile-inline')
  assert.equal(payload.groups.find(item => item.id === jump.group_id).parent_id, 'group-root')
  const inline = payload.profiles.find(item => item.id === 'profile-inline')
  const publicBytes = Buffer.from(vault.credential.public_key.split(' ')[1], 'base64')
  const fingerprint = `SHA256:${createHash('sha256').update(publicBytes).digest('base64').replace(/=+$/, '')}`
  assert.equal(JSON.parse(inline.options).host_key_fingerprint, fingerprint)
  assert.equal(JSON.parse(inline.options).unknown_option['中文'], true)
})

test('none specimens never retain vault bodies, references or proxy/inline secrets', async () => {
  for (const filename of ['eizhu-none.eizhubackup', 'xcontrol-none.xcbackup']) {
    const text = await readFile(path.join(baselineDirectory, filename), 'utf8')
    for (const marker of ['fixture-only-内联密码', 'fixture-only-代理密码', 'PRIVATE KEY', 'vault-password', 'vault-key']) assert.ok(!text.includes(marker))
  }
})

test('a changed frozen fixture is rejected before any cryptographic or UI comparison', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'eizhu-baseline-tamper-'))
  try {
    await cp(baselineDirectory, directory, { recursive: true })
    const file = path.join(directory, 'payload-plain.json')
    await writeFile(file, `${await readFile(file, 'utf8')} `)
    await assert.rejects(verifyBaseline(directory), /Asset size changed/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('adding an unreviewed file cannot silently expand the frozen evidence set', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'eizhu-baseline-extra-'))
  try {
    await cp(baselineDirectory, directory, { recursive: true })
    await writeFile(path.join(directory, 'unreviewed.json'), '{}')
    await assert.rejects(verifyBaseline(directory), /Frozen asset set changed/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('acceptance coverage rejects orphan mappings and duplicate interfaces', async () => {
  const cases = (await readJson(path.join(baselineDirectory, 'cases.json'))).cases
  const inventory = await readJson(path.join(baselineDirectory, 'legacy-interfaces.json'))
  const orphan = structuredClone(inventory); orphan.commands[0].caseIds = ['MISSING-01']
  assert.throws(() => validateCoverage(cases, orphan), /Unknown acceptance ID/)
  const duplicate = structuredClone(inventory); duplicate.commands.push(duplicate.commands[0])
  assert.throws(() => validateCoverage(cases, duplicate), /Duplicate commands/)
})

test('fixture lookup rejects paths outside the evidence directory', () => {
  for (const name of ['../key', '/etc/passwd', 'nested/../../key', '..\\key']) assert.throws(() => resolveAsset(baselineDirectory, name))
})

test('legacy interfaces can be reconstructed from the frozen Git source after deleting the old runtime', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const manifest = await readJson(path.join(baselineDirectory, 'manifest.json'))
  const frozen = await readJson(path.join(baselineDirectory, 'legacy-interfaces.json'))
  assert.deepEqual(await collectLegacyInventory(root, { revision: manifest.sourceCommit }), frozen)
})
