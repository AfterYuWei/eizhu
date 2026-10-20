import assert from 'node:assert/strict'
import { argon2, createDecipheriv, createHash, timingSafeEqual } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { filesUnder } from './desktop-baseline-inventory.mjs'

const deriveArgon2 = promisify(argon2)
export const baselineDirectory = fileURLToPath(new URL('../tests/fixtures/desktop-baseline/', import.meta.url))
export const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export function resolveAsset(directory, relative) {
  assert.equal(typeof relative, 'string')
  assert.ok(relative.length > 0 && !relative.includes('\\') && !path.isAbsolute(relative), 'Invalid asset path')
  const result = path.resolve(directory, relative)
  assert.ok(result.startsWith(`${path.resolve(directory)}${path.sep}`), 'Asset escapes the baseline directory')
  return result
}

export async function deriveBackupKey(kdf, password) {
  assert.equal(kdf.algo, 'argon2id')
  // This verifier reads trusted, frozen specimens, not arbitrary user files.
  // The production importer will enforce the complete v1 validation policy.
  assert.equal(kdf.time, 3)
  assert.equal(kdf.memory, 65536)
  assert.equal(kdf.threads, 2)
  return deriveArgon2('argon2id', { message: Buffer.from(password, 'utf8'), nonce: Buffer.from(kdf.salt, 'base64'), parallelism: kdf.threads, tagLength: 32, memory: kdf.memory, passes: kdf.time })
}

export function decrypt(key, encoded, aad) {
  const bytes = Buffer.from(encoded, 'base64')
  assert.ok(bytes.length >= 28)
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(bytes.subarray(-16))
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()])
}

export async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')) }

export function imageDimensions(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    assert.ok(bytes.length >= 24)
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  assert.ok(bytes[0] === 255 && bytes[1] === 216, 'Expected a PNG or JPEG screenshot')
  let offset = 2
  while (offset + 4 <= bytes.length) {
    assert.equal(bytes[offset], 255, 'Invalid JPEG marker')
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]
    if (marker === 217 || marker === 218) break
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue
    const length = bytes.readUInt16BE(offset)
    assert.ok(length >= 2 && offset + length <= bytes.length, 'Invalid JPEG segment')
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      assert.ok(length >= 8)
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
    }
    offset += length
  }
  throw new Error('JPEG screenshot lacks dimensions')
}

export function validateCoverage(cases, inventory) {
  assert.ok(cases.length > 0)
  const ids = new Set(cases.map(item => item.id))
  assert.equal(ids.size, cases.length, 'Duplicate acceptance IDs')
  for (const item of cases) {
    for (const field of ['area', 'entry', 'acceptance', 'failure']) assert.ok(item[field]?.trim(), `${item.id} lacks ${field}`)
    assert.ok(item.evidence.length, `${item.id} lacks an evidence source`)
  }
  for (const kind of ['commands', 'events']) {
    assert.ok(inventory[kind].length > 0)
    const names = new Set()
    for (const item of inventory[kind]) {
      assert.ok(!names.has(item.name), `Duplicate ${kind}: ${item.name}`)
      names.add(item.name)
      assert.ok(item.caseIds.length, `Unmapped ${kind}: ${item.name}`)
      for (const id of item.caseIds) assert.ok(ids.has(id), `Unknown acceptance ID ${id} for ${item.name}`)
      assert.ok(item.disposition, `Missing disposition: ${item.name}`)
    }
  }
  const referenced = new Set([...inventory.commands, ...inventory.events].flatMap(item => item.caseIds))
  // Some UI-only cases have no backend command; they still need explicit evidence.
  for (const id of ['BACKUP-01', 'SYNC-01', 'ACCOUNT-02', 'SFTP-03', 'EDITOR-03', 'CLEAN-01', 'CLEAN-02']) {
    assert.ok(referenced.has(id), `Missing critical behavior: ${id}`)
  }
}

export async function verifyBaseline(directory = baselineDirectory, { checkSource = false } = {}) {
  const manifest = await readJson(path.join(directory, 'manifest.json'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.syntheticOnly, true)
  assert.equal(manifest.userApproved, false, 'Approval is recorded in the delivery log, never silently edited into frozen evidence')
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/)
  const actualFiles = (await filesUnder(directory, '.')).filter(file => file !== 'manifest.json').sort()
  assert.deepEqual(actualFiles, manifest.files.map(file => file.path).sort(), 'Frozen asset set changed')
  const seen = new Set()
  for (const file of manifest.files) {
    assert.ok(!seen.has(file.path), `Duplicate asset ${file.path}`); seen.add(file.path)
    const bytes = await readFile(resolveAsset(directory, file.path))
    assert.equal(bytes.length, file.bytes, `Asset size changed: ${file.path}`)
    assert.equal(hash(bytes), file.sha256, `Frozen asset changed: ${file.path}`)
  }
  for (const name of ['cases.json', 'legacy-interfaces.json', 'backup-vectors.json', 'sync-v2-vectors.json', 'screenshots.json', 'invalid-cases.json']) assert.ok(seen.has(name), `Missing required asset ${name}`)
  const cases = (await readJson(path.join(directory, 'cases.json'))).cases
  const inventory = await readJson(path.join(directory, 'legacy-interfaces.json'))
  validateCoverage(cases, inventory)
  assert.equal(cases.length, manifest.counts.cases)
  assert.equal(inventory.commands.length, manifest.counts.commands)
  assert.equal(inventory.commands.filter(item => item.desktop).length, manifest.counts.desktopCommands)
  assert.equal(inventory.events.length, manifest.counts.events)
  let backupFiles = 0
  const vectors = await readJson(path.join(directory, 'backup-vectors.json'))
  for (const mode of ['none', 'plain', 'encrypted']) {
    const expectedBytes = await readFile(path.join(directory, `payload-${mode}.json`))
    const expected = JSON.parse(expectedBytes)
    for (const [format, extension] of [['eizhu', 'eizhubackup'], ['xcontrol', 'xcbackup']]) {
      const filename = `${format}-${mode}.${extension}`
      const file = await readJson(path.join(directory, filename))
      assert.equal(file.format, `${format}-backup`); assert.equal(file.version, 1); assert.equal(file.credential_mode, mode)
      let decoded
      if (mode === 'encrypted') {
        const vector = vectors.vectors.find(item => item.file === filename)
        assert.ok(vector)
        const key = await deriveBackupKey(file.kdf, vector.password)
        try {
          assert.ok(timingSafeEqual(key, Buffer.from(vector.derivedKeyHex, 'hex')), 'Rust/Node Argon2id mismatch')
          const raw = decrypt(key, file.payload, `${file.format}:1`)
          assert.equal(hash(raw), vector.plaintextSha256)
          assert.deepEqual(raw, expectedBytes, 'Legacy canonical payload byte order changed')
          decoded = JSON.parse(raw)
        } finally { key.fill(0) }
      } else decoded = Object.fromEntries(['groups', 'vault', 'profiles', 'snippets'].map(name => [name, file[name] ?? []]))
      assert.deepEqual(decoded, expected)
      assert.equal(decoded.groups.length, 2); assert.equal(decoded.profiles.length, 6); assert.equal(decoded.snippets.length, 2)
      assert.equal(decoded.vault.length, mode === 'none' ? 0 : 2)
      if (mode === 'none') {
        for (const profile of decoded.profiles) {
          assert.ok(!profile.inline_credential && !profile.proxy_password && !profile.vault_id)
          assert.notEqual(profile.auth_type, 'vault')
        }
      }
      backupFiles++
    }
  }
  const historical = await readJson(path.join(directory, 'xcontrol-historical-empty.xcbackup'))
  const historicalKey = await deriveBackupKey(historical.kdf, 'backup-pass')
  try {
    assert.equal(decrypt(historicalKey, historical.payload, 'xcontrol-backup:1').toString('utf8'), '{"groups":[],"vault":[],"profiles":[],"snippets":[]}')
  } finally { historicalKey.fill(0) }
  const invalid = await readJson(path.join(directory, 'invalid-cases.json'))
  assert.equal(invalid.synthetic, true)
  assert.equal(invalid.cases.length, 10)
  for (const item of invalid.cases) {
    assert.ok(seen.has(item.file), `Untracked rejection specimen ${item.file}`)
    assert.match(item.importCode, /^[A-Z][A-Z_]+$/)
    assert.match(item.previewCode, /^[A-Z][A-Z_]+$/)
    assert.equal(item.originalPayloadPreserved, true)
  }
  const sync = await readJson(path.join(directory, 'sync-v2-vectors.json'))
  const envelope = sync.envelope
  const wrapKey = await deriveBackupKey({ algo: 'argon2id', salt: envelope.salt, time: envelope.time, memory: envelope.memory, threads: envelope.threads }, sync.password)
  const dataKey = Buffer.from(sync.dataKeyHex, 'hex')
  try {
    assert.deepEqual(decrypt(wrapKey, envelope.wrappedKey, sync.keyAadUtf8), dataKey)
    for (const item of sync.items) {
      assert.equal(JSON.stringify(['eizhu:item', 2, item.userId, item.itemType, item.itemId, item.revision, item.epoch, 1, item.deleted]), item.aadUtf8)
      assert.equal(decrypt(dataKey, item.ciphertext, item.aadUtf8).toString('utf8'), item.plaintextUtf8)
      const push = JSON.parse(item.pushUtf8)
      assert.equal(JSON.stringify(push), item.pushUtf8)
      assert.equal(push.items[0].payload, item.ciphertext)
    }
  } finally { wrapKey.fill(0); dataKey.fill(0) }
  const screenshots = await readJson(path.join(directory, 'screenshots.json'))
  for (const shot of screenshots.captured) {
    assert.ok(seen.has(shot.file), `Untracked screenshot ${shot.file}`)
    const bytes = await readFile(resolveAsset(directory, shot.file))
    assert.deepEqual(imageDimensions(bytes), { width: shot.width, height: shot.height })
    assert.equal(shot.runtime, 'browser-preview')
  }
  if (checkSource) {
    const root = fileURLToPath(new URL('../', import.meta.url))
    const tree = execFileSync('git', ['ls-tree', '-r', manifest.sourceCommit], { cwd: root, encoding: 'utf8', maxBuffer: 8 << 20 })
    const blobs = new Map(tree.trim().split('\n').map(line => {
      const match = /^\d+ blob ([a-f0-9]+)\t(.+)$/.exec(line)
      return match ? [match[2], match[1]] : [null, null]
    }))
    for (const source of manifest.sourceFiles) assert.equal(blobs.get(source.path), source.gitBlob, `Source snapshot mismatch: ${source.path}`)
  }
  return { sourceCommit: manifest.sourceCommit, cases: cases.length, commands: inventory.commands.length, events: inventory.events.length, assets: manifest.files.length, backupFiles: backupFiles + 1, rejectedBackupFiles: invalid.cases.length, syncItems: sync.items.length, browserScreenshots: screenshots.captured.length, nativeEvidence: 'pending', userApprovalAtCapture: 'pending' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await verifyBaseline(baselineDirectory, { checkSource: process.argv.includes('--check-source') }), null, 2))
}
