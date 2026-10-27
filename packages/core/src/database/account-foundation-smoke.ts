import assert from 'node:assert/strict'
import { parentPort, workerData } from 'node:worker_threads'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import { DesktopError, offlineWorkspace } from '@eizhu/contracts'
import { FoundationStore } from './store.ts'
import { LocalCipher } from '../local/crypto.ts'
import { accountWorkspace } from '../account/workspace.ts'
import type { AccountSession } from '../account/repository.ts'
import { answerWorker } from '../workers/client.ts'
import { accountFixtureKey } from './account-fixture.ts'

/** Native SQLite evidence runs inside an isolated Electron database Worker. No real accounts or user data. */
async function verify() {
  const { root } = workerData as { root: string }
  await mkdir(root, { recursive: true, mode: 0o700 })
  const key = accountFixtureKey(),
    checks: string[] = []
  const path = join(root, 'workspaces', 'offline', 'workspace.sqlite')
  const globalPath = join(root, 'global.sqlite')
  const code = (expected: string) => (cause: unknown) =>
    cause instanceof DesktopError && cause.error.code === expected
  let store: FoundationStore | undefined
  try {
    store = new FoundationStore(root, key)
    const group = store.local.execute('group.create', { request: { name: '升级前离线分组' } }) as {
      id: string
    }
    store.local.execute('vault.create', {
      request: {
        name: '合成凭据',
        type: 'password',
        username: 'synthetic',
        password: 'SYNTHETIC-LOCAL-SECRET',
      },
    })
    store.writeSetting('eizhu-settings', '{"theme":"dark"}')
    const before = store.local.snapshot()
    store.close()
    store = undefined

    // Produce the exact preceding schema shape, retaining its already encrypted entities/outbox.
    const legacy = new Database(path)
    legacy.exec(`DROP TABLE sync_state; DROP TABLE sync_shadow; DROP TABLE sync_requests;
      DROP TABLE sync_conflicts; DROP TABLE sync_previews; DROP INDEX outbox_item_revision; PRAGMA user_version=2;`)
    const oldOutbox = legacy.prepare('SELECT * FROM outbox ORDER BY sequence').all()
    legacy.close()
    const oldGlobal = new Database(globalPath)
    oldGlobal.exec('DROP TABLE account_sessions; DROP TABLE global_state; PRAGMA user_version=1;')
    oldGlobal.close()

    assert.throws(() => new FoundationStore(root, randomBytes(32)), code('DATA_DECRYPT_FAILED'))
    const intact = new Database(globalPath, { readonly: true })
    assert.equal(intact.pragma('user_version', { simple: true }), 1)
    intact.close()
    checks.push('旧库密钥错误：拒绝初始化，原全局 schema 与密文保留')

    store = new FoundationStore(root, key)
    assert.deepEqual(store.local.snapshot(), before)
    assert.equal(store.settings()['eizhu-settings'], '{"theme":"dark"}')
    const migrated = new Database(path, { readonly: true })
    assert.equal(migrated.pragma('user_version', { simple: true }), 3)
    assert.deepEqual(migrated.prepare('SELECT * FROM outbox ORDER BY sequence').all(), oldOutbox)
    const encryptedEntity = (
      migrated.prepare('SELECT data FROM entities WHERE id=?').get(group.id) as { data: Buffer }
    ).data
    migrated.close()
    for (const [name, version] of [
      ['global-v1-before-v2.sqlite', 1],
      ['offline-v2-before-v3.sqlite', 2],
    ] as const) {
      const backup = join(root, 'schema-backups', name),
        db = new Database(backup, { readonly: true })
      assert.equal(db.pragma('user_version', { simple: true }), version)
      db.close()
      if (process.platform !== 'win32') assert.equal((await stat(backup)).mode & 0o777, 0o600)
    }
    checks.push('全局 v1→v2、业务 v2→v3：设置、实体、原 outbox 密文保留；一致性副本可读取')

    const a = accountWorkspace(42),
      b = accountWorkspace(43)
    const session = (id: number): AccountSession => ({
      user: {
        id,
        email: `synthetic-${id}@example.invalid`,
        emailVerified: true,
        verificationRequired: true,
        storageUsed: 0,
        storageQuota: 1024,
      },
      syncEnabled: true,
      tokens: {
        accessToken: `SYNTHETIC-ACCESS-${id}`,
        refreshToken: `SYNTHETIC-REFRESH-${id}`,
        expiresAt: Date.now() + 3600000,
      },
      cachedSyncKey: { key: '09'.repeat(32), revision: 4 },
    })
    store.accounts.save(a, session(42))
    store.accounts.save(b, session(43))
    assert.equal(store.accounts.status(a).sessionState, 'authenticated')
    store.accounts.save(a, { ...session(42), tokens: { ...session(42).tokens!, expiresAt: 1 } })
    assert.equal(store.accounts.status(a).sessionState, 'authenticated')
    store.accounts.save(a, { ...session(42), tokens: null })
    assert.equal(store.accounts.status(a).sessionState, 'reauth_required')
    store.accounts.save(a, session(42))
    assert.equal(JSON.stringify(store.accounts.status(a)).includes('SYNTHETIC-ACCESS'), false)
    assert.equal(JSON.stringify(store.accounts.status(a)).includes('cachedSyncKey'), false)
    assert.throws(() => store!.accounts.save(a, session(43)), code('WORKSPACE_INVALID'))
    store.accounts.activate(a)
    store.close()
    store = undefined
    const globalBytes = await readFile(globalPath)
    assert.equal(globalBytes.includes(Buffer.from('SYNTHETIC-ACCESS')), false)
    assert.equal(globalBytes.includes(Buffer.from('SYNTHETIC-REFRESH')), false)
    assert.equal(globalBytes.includes(Buffer.from('09'.repeat(32))), false)
    checks.push('会话与解锁缓存加密；公开状态不包含令牌/密钥；过期保留账号身份')

    store = new FoundationStore(root, key)
    assert.equal(store.identity.id, a.id)
    assert.equal(store.local.snapshot().groups.length, 0)
    assert.equal(store.accounts.session(a)?.cachedSyncKey?.revision, 4)
    store.local.execute('group.create', { request: { name: '账号 A 独立分组' } })
    const accountPayload = store.local.snapshot()
    const cipher = new LocalCipher(key, a.id)
    try {
      assert.throws(
        () => cipher.open(encryptedEntity, `entity:groups:${group.id}`),
        code('DATA_DECRYPT_FAILED'),
      )
    } finally {
      cipher.close()
    }
    store.close()
    store = undefined
    store = new FoundationStore(root, key, b)
    assert.equal(store.local.snapshot().groups.length, 0)
    store.close()
    store = undefined
    store = new FoundationStore(root, key, offlineWorkspace)
    assert.deepEqual(store.local.snapshot(), before)
    checks.push('重启恢复活动账号；A/B/离线分别存储并派生密钥，未自动导入离线数据')

    const inspect = new Database(globalPath)
    const savedA = (
      inspect.prepare('SELECT data FROM account_sessions WHERE workspace_id=?').get(a.id) as { data: Buffer }
    ).data
    const savedB = (
      inspect.prepare('SELECT data FROM account_sessions WHERE workspace_id=?').get(b.id) as { data: Buffer }
    ).data
    inspect.prepare('UPDATE account_sessions SET data=? WHERE workspace_id=?').run(savedA, b.id)
    assert.throws(() => store!.accounts.session(b), code('DATA_DECRYPT_FAILED'))
    inspect.prepare('UPDATE account_sessions SET data=? WHERE workspace_id=?').run(savedB, b.id)
    assert.throws(() => store!.accounts.update(a, 'stale-refresh', { tokens: null }), code('ACCOUNT_SESSION_CHANGED'))
    const rotated = store.accounts.update(a, session(42).tokens!.refreshToken, { tokens: { ...session(42).tokens!, refreshToken: 'SYNTHETIC-ROTATED-REFRESH' } })
    assert.equal(rotated.tokens?.refreshToken, 'SYNTHETIC-ROTATED-REFRESH')
    assert.throws(() => store!.accounts.update(a, session(42).tokens!.refreshToken, { tokens: null }), code('ACCOUNT_SESSION_CHANGED'))
    inspect.exec("CREATE TRIGGER account_smoke_fail_logout BEFORE DELETE ON account_sessions BEGIN SELECT RAISE(ABORT,'synthetic logout failure'); END")
    assert.throws(() => store!.accounts.commitTransition(offlineWorkspace, a))
    assert.equal(store.accounts.active().id, a.id)
    assert.ok(store.accounts.session(a)?.tokens)
    inspect.exec('DROP TRIGGER account_smoke_fail_logout')
    inspect.close()
    store.accounts.commitTransition(offlineWorkspace, a)
    assert.equal(store.accounts.active().id, 'offline')
    assert.equal(store.accounts.session(a), null)
    assert.ok(store.accounts.session(b)?.tokens)
    store.close()
    store = undefined
    store = new FoundationStore(root, key, a)
    assert.deepEqual(store.local.snapshot(), accountPayload)
    assert.equal(store.accounts.status(a).sessionState, 'reauth_required')
    assert.throws(() => new FoundationStore(root, key, { ...a, userId: 43 }), code('WORKSPACE_INVALID'))
    store.close()
    store = undefined
    assert.throws(() => new FoundationStore(root, randomBytes(32)), code('DATA_DECRYPT_FAILED'))
    checks.push('跨账号搬移密文不能解密；退出清除本账号会话和缓存，保留业务库及其他账号')
    checks.push('刷新令牌 CAS 拒绝旧结果；活动空间切换与退出清理在同一 SQLite 事务，中途失败整体回滚')

    // A DDL failure must not leave a partially upgraded business database.
    const brokenRoot = join(root, 'migration-failure')
    store = new FoundationStore(brokenRoot, key)
    store.close()
    store = undefined
    const brokenPath = join(brokenRoot, 'workspaces', 'offline', 'workspace.sqlite')
    const broken = new Database(brokenPath)
    broken.exec(`DROP TABLE sync_state; DROP TABLE sync_requests; DROP TABLE sync_conflicts;
      DROP TABLE sync_previews; DROP INDEX outbox_item_revision; PRAGMA user_version=2;`)
    assert.throws(() => new FoundationStore(brokenRoot, key))
    assert.equal(broken.pragma('user_version', { simple: true }), 2)
    assert.equal(
      (
        broken.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='sync_state'").get() as {
          n: number
        }
      ).n,
      0,
    )
    broken.exec('DROP TABLE sync_shadow')
    broken.close()
    store = new FoundationStore(brokenRoot, key)
    store.close()
    store = undefined
    checks.push('业务迁移中途失败整体回滚；修复阻断后可重试')
    store = new FoundationStore(root, key, offlineWorkspace)
    store.accounts.activate(b)
    store.close()
    store = undefined
    return { passed: true, checks, fixtureRoot: root }
  } finally {
    store?.close()
    key.fill(0)
  }
}

parentPort!.on('message', async (message) => {
  parentPort!.postMessage(
    await answerWorker(message, (operation) => (operation === 'verify' ? verify() : undefined)),
  )
})
