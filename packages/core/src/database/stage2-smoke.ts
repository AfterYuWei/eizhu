import assert from 'node:assert/strict'
import { parentPort, workerData } from 'node:worker_threads'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { DesktopError, failureOf, local } from '@eizhu/contracts'
import type { LocalOperation, LocalInput, LocalOutput } from '@eizhu/contracts'
import { FoundationStore } from './store.ts'
import { decodeBackup, encodeBackup, readBounded } from '../local/backup.ts'
import { orderedPayload, proxyOf, validateGraph } from '../local/model.ts'
import { generateKeyPair, prepareCredential } from '../local/keys.ts'
import { answerWorker } from '../workers/client.ts'

/** Executed only by the isolated Electron smoke harness, never by Node's native-module test runner. */
async function verify() {
  const { root, fixtures } = workerData as { root: string; fixtures: string }
  await mkdir(root, { recursive: true, mode: 0o700 })
  const key = randomBytes(32)
  let foundation = new FoundationStore(root, key)
  const path = join(root, 'workspaces', 'offline', 'workspace.sqlite')
  const inspect = new Database(path)
  const counters = () =>
    Object.fromEntries(
      ['entities', 'audit', 'outbox', 'safety_snapshots', 'restore_previews'].map((table) => [
        table,
        (inspect.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
      ]),
    )
  const run = <K extends LocalOperation>(operation: K, input: LocalInput<K>): LocalOutput<K> =>
    local[operation].output.parse(
      foundation.local.execute(operation, local[operation].input.parse(input)),
    ) as LocalOutput<K>
  const code = (expected: string) => (cause: unknown) =>
    cause instanceof DesktopError && cause.error.code === expected
  const prepare = (payload: ReturnType<typeof foundation.local.snapshot>) =>
    foundation.local.prepare({
      payload,
      mode: 'plain',
      exportedAt: '',
      source: { kind: 'file', name: '合成测试备份' },
    })
  const checks: string[] = []
  try {
    const rootGroup = run('group.create', { request: { name: '父组' } })
    const child = run('group.create', { request: { name: '子组', parent_id: rootGroup.id } })
    const unchanged = prepare(foundation.local.snapshot())
    assert.equal(unchanged.changes.groups.unchanged, 2)
    assert.throws(
      () => run('group.update', { id: rootGroup.id, request: { parent_id: child.id } }),
      code('VALIDATION'),
    )
    assert.throws(() => run('group.delete', { id: rootGroup.id }), code('IN_USE'))
    const vault = run('vault.create', {
      request: {
        name: '合成凭据',
        type: 'password',
        username: 'deploy',
        password: 'SYNTHETIC-secret-数据库不可见',
      },
    })
    const jump = run('profile.create', {
      request: {
        name: '',
        host: 'jump.example.invalid',
        username: 'deploy',
        auth_type: 'vault',
        vault_id: vault.id,
        group_id: child.id,
      },
    })
    assert.equal(jump.name, 'jump.example.invalid')
    const profile = run('profile.create', {
      request: {
        name: '合成服务器',
        host: 'server.example.invalid',
        username: 'deploy',
        auth_type: 'password',
        password: 'SYNTHETIC-inline-secret',
        proxy: { type: 'jump', jump_profile_id: jump.id },
        options: '{"未知选项":{"中文":true}}',
      },
    })
    assert.throws(
      () =>
        run('profile.update', {
          id: jump.id,
          request: { proxy: { type: 'jump', jump_profile_id: profile.id } },
        }),
      code('INVALID_PROXY_CHAIN'),
    )
    assert.throws(() => run('profile.delete', { id: jump.id }), code('IN_USE'))
    assert.throws(() => run('vault.delete', { id: vault.id }), code('IN_USE'))
    assert.throws(
      () =>
        run('vault.update', {
          id: vault.id,
          request: { name: '改类型', type: 'private_key', private_key: 'fake' },
        }),
      code('VALIDATION'),
    )
    run('vault.update', {
      id: vault.id,
      request: { name: '合成凭据', type: 'password', username: 'root', password: 'SYNTHETIC-new-secret' },
    })
    assert.equal(run('profile.get', { id: jump.id }).username, 'root')
    assert.equal(run('vault.get', { id: vault.id }).ref_count, 1)
    const metadata = JSON.stringify([
      run('profile.list', { groupId: null, search: null }),
      run('vault.list', { vaultType: null, q: null }),
      run('audit.list', { limit: 500 }),
    ])
    assert.ok(!metadata.includes('SYNTHETIC-'))
    assert.equal(run('vault.reveal', { id: vault.id }).password, 'SYNTHETIC-new-secret')
    assert.equal(run('profile.list', { groupId: null, search: 'server.example.invalid' }).length, 1)
    run('snippet.create', {
      request: { name: '多行中文', content: 'echo 第一行\necho 第二行', tags: ['测试'] },
    })
    run('localState.write', { key: 'shortcuts', value: { search: 'Ctrl+K' } })
    assert.deepEqual(run('localState.read', { key: 'shortcuts' }), { search: 'Ctrl+K' })
    checks.push('本地 CRUD、查询、默认名称、引用保护、用户名联动、循环拒绝与脱敏列表')

    const before = foundation.local.snapshot(),
      counts = counters()
    inspect.exec(
      "CREATE TRIGGER smoke_fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'synthetic transaction failure'); END",
    )
    assert.throws(() => run('profile.update', { id: profile.id, request: { note: '必须回滚' } }))
    assert.deepEqual(foundation.local.snapshot(), before)
    assert.deepEqual(counters(), counts)
    const rollbackCandidate = structuredClone(before)
    rollbackCandidate.profiles[0].note = '必须回滚安全快照'
    const rollbackPreview = prepare(rollbackCandidate),
      snapshotCounts = counters()
    assert.throws(() => foundation.local.apply(rollbackPreview.token, 'replace'))
    assert.deepEqual(foundation.local.snapshot(), before)
    assert.deepEqual(counters(), snapshotCounts)
    inspect.exec('DROP TRIGGER smoke_fail_outbox')
    checks.push('真实 SQLite 中途失败：业务、审计、outbox、安全快照与预览消费整体回滚')

    const fixturePassword = 'fixture-only-备份密码🔐'
    for (const prefix of ['eizhu', 'xcontrol'])
      for (const mode of ['none', 'plain', 'encrypted']) {
        const extension = prefix === 'eizhu' ? 'eizhubackup' : 'xcbackup'
        const decoded = await decodeBackup(
          await readFile(join(fixtures, `${prefix}-${mode}.${extension}`)),
          fixturePassword,
        )
        const expected = await readFile(join(fixtures, `payload-${mode}.json`), 'utf8')
        assert.equal(JSON.stringify(orderedPayload(decoded.payload)), expected)
        foundation.local.apply(prepare(decoded.payload).token, 'replace')
        const result = foundation.local.snapshot()
        assert.equal(result.profiles.length, 6)
        validateGraph(result)
        if (mode === 'none') {
          assert.equal(result.vault.length, 0)
          assert.ok(!JSON.stringify(result).includes('fixture-only-'))
          assert.equal(result.profiles.find((p) => p.id === 'profile-vault')!.auth_type, 'none')
        } else assert.equal(run('vault.reveal', { id: 'vault-key' }).passphrase, 'fixture-only-私钥口令')
      }
    const historical = await decodeBackup(
      await readFile(join(fixtures, 'xcontrol-historical-empty.xcbackup')),
      'backup-pass',
    )
    assert.equal(historical.payload.profiles.length, 0)
    checks.push('七个固定旧备份：两种格式、三种凭据模式、历史 Go 密文及精确 payload 字节')

    const invalid = JSON.parse(await readFile(join(fixtures, 'invalid-cases.json'), 'utf8')) as {
      cases: Array<{ file: string; password: string; previewCode: string; importCode: string }>
    }
    for (const entry of invalid.cases) {
      const current = foundation.local.snapshot(),
        counts = counters()
      await assert.rejects(async () => {
        const decoded = await decodeBackup(await readFile(join(fixtures, entry.file)), entry.password)
        prepare(decoded.payload)
      }, code(entry.previewCode))
      await assert.rejects(async () => {
        const decoded = await decodeBackup(await readFile(join(fixtures, entry.file)), entry.password)
        foundation.local.apply(prepare(decoded.payload).token, 'overwrite')
      }, code(entry.importCode))
      assert.deepEqual(foundation.local.snapshot(), current)
      assert.deepEqual(counters(), counts)
    }
    checks.push('十个固定反例：生产预览/导入错误码及完整数据保留')

    const payload = foundation.local.snapshot(),
      plain = await encodeBackup(payload, 'plain'),
      encrypted = await encodeBackup(payload, 'encrypted', '  中文🔐密码  ')
    assert.equal(
      plain.hash,
      createHash('sha256')
        .update(JSON.stringify(orderedPayload(payload)))
        .digest('hex'),
    )
    assert.deepEqual((await decodeBackup(encrypted.bytes, '  中文🔐密码  ')).payload, payload)
    await assert.rejects(decodeBackup(encrypted.bytes, '中文🔐密码'), code('INVALID_PASSWORD'))
    await assert.rejects(decodeBackup(Buffer.alloc(50 * 1024 * 1024 + 1)), code('FILE_TOO_LARGE'))
    checks.push('生产导出往返、加密前 hash、中文/emoji/首尾空白密码及 50 MiB 上限')

    const original = foundation.local.snapshot()
    run('profile.update', { id: 'profile-inline', request: { note: '保留本地编辑' } })
    const skip = foundation.local.apply(prepare(original).token, 'skip')
    assert.equal(skip.skipped.profiles, 6)
    assert.equal(run('profile.get', { id: 'profile-inline' }).note, '保留本地编辑')
    foundation.local.apply(prepare(original).token, 'overwrite')
    assert.equal(run('profile.get', { id: 'profile-inline' }).note, '测试专用，不连接真实服务器')
    const regen = foundation.local.apply(prepare(original).token, 'regenerate')
    assert.equal(regen.imported.profiles, 6)
    const regenerated = foundation.local.snapshot()
    assert.equal(regenerated.profiles.length, 12)
    const newJump = regenerated.profiles.find(
      (p) => p.name.includes('profile-jump') && p.id !== 'profile-jump',
    )!
    assert.notEqual(proxyOf(newJump).jump_profile_id, 'profile-inline')
    assert.notEqual(newJump.group_id, 'group-child')
    assert.notEqual(newJump.vault_id, 'vault-key')
    validateGraph(regenerated)
    const stale = prepare(original)
    run('snippet.create', { request: { name: '使预览失效', content: 'true' } })
    assert.throws(() => foundation.local.apply(stale.token, 'replace'), code('PREVIEW_CHANGED'))
    const expired = prepare(original)
    inspect.prepare('UPDATE restore_previews SET expires=0 WHERE token=?').run(expired.token)
    assert.throws(() => foundation.local.apply(expired.token, 'replace'), code('PREVIEW_EXPIRED'))
    const merged = foundation.local.apply(prepare(original).token, 'overwrite')
    assert.equal(merged.snapshot.profiles.length, 12)
    foundation.local.apply(prepare(original).token, 'replace')
    assert.equal(foundation.local.snapshot().profiles.length, 6)
    const safety = run('backup.safetyVersions', undefined)[0]
    const safetyPreview = run('backup.previewSafety', { id: safety.id })
    run('backup.applyRestore', { token: safetyPreview.token, mode: 'replace' })
    assert.equal(foundation.local.snapshot().profiles.length, 12)
    checks.push(
      'skip/overwrite/regenerate、分组/凭据/跳板 ID 重映射、merge/replace、过期/编辑失效与安全快照恢复',
    )

    for (const [algo, bits] of [
      ['ed25519', undefined],
      ['rsa', 2048],
      ['rsa', 4096],
    ] as const) {
      const pair = generateKeyPair({ request: { algo, bits, passphrase: '合成 key 密语' } })
      assert.match(pair.private_key, /BEGIN OPENSSH PRIVATE KEY/)
      const parsed = prepareCredential(
        {
          private_key: pair.private_key,
          public_key: pair.public_key + ' fixture@example.invalid',
          passphrase: '合成 key 密语',
        },
        'private_key',
      )
      assert.ok('public_key' in parsed.credential)
      assert.match(parsed.credential.public_key!, /fixture@example.invalid$/)
      assert.throws(
        () => prepareCredential({ private_key: pair.private_key, passphrase: 'wrong' }, 'private_key'),
        code('INVALID_PRIVATE_KEY'),
      )
    }
    checks.push('ED25519/RSA2048/RSA4096 OpenSSH 加密私钥、注释与错误口令拒绝')

    const persisted = foundation.local.snapshot()
    inspect.close()
    foundation.close()
    const bytes = await readFile(path)
    assert.ok(!bytes.includes(Buffer.from('fixture-only-')))
    assert.ok(!bytes.includes(Buffer.from('OPENSSH PRIVATE KEY')))
    assert.ok(!bytes.includes(Buffer.from('SYNTHETIC-')))
    assert.throws(() => new FoundationStore(root, randomBytes(32)), code('DATA_DECRYPT_FAILED'))
    foundation = new FoundationStore(root, key)
    assert.deepEqual(foundation.local.snapshot(), persisted)
    assert.deepEqual(run('localState.read', { key: 'shortcuts' }), { search: 'Ctrl+K' })
    checks.push('SQLite 无明文凭据、正确密钥重启持久化、错误密钥拒绝并保留原数据')
    await assert.rejects(readBounded(join(fixtures, 'eizhu-plain.eizhubackup'), 1), code('FILE_TOO_LARGE'))
    return {
      passed: true,
      checks,
      fixedBackups: 7,
      invalidCases: invalid.cases.length,
      nativeDatabase: true,
      keyAlgorithms: 3,
    }
  } finally {
    if (inspect.open) inspect.close()
    foundation.close()
    key.fill(0)
  }
}
parentPort!.on('message', async (message) => {
  const response = await answerWorker(message, (operation) => {
    if (operation === 'verify') return verify()
    if (operation === 'close') return
    throw new DesktopError({ code: 'UNKNOWN_OPERATION', message: '无效测试操作' })
  })
  parentPort!.postMessage(response)
})
process.on('uncaughtException', (cause) => {
  parentPort!.postMessage({ fatal: failureOf(cause) })
  process.exit(1)
})
