import assert from 'node:assert/strict'
import { parentPort, workerData } from 'node:worker_threads'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { DesktopError, offlineWorkspace } from '@eizhu/contracts'
import { FoundationStore } from './store.ts'
import { masterCrypto } from '../account/crypto.ts'
import type { MasterKeys } from '../account/crypto.ts'
import { AccountService } from '../account/service.ts'
import { workerAccountStorage } from '../account/storage.ts'
import { accountWorkspace } from '../account/workspace.ts'
import { SyncService } from '../sync/service.ts'
import { SyncFixture } from '../sync/fixture.ts'
import { executeCrypto, itemAad, open, unwrap, wrap } from '../sync/crypto.ts'
import type { WorkerClient } from '../workers/client.ts'
import type { SyncConflict, SyncPreview } from '@eizhu/contracts'
import type { WireItem } from '../sync/model.ts'
import { answerWorker } from '../workers/client.ts'

const code = (expected: string) => (e: unknown) => e instanceof DesktopError && e.error.code === expected
async function verify() {
  const { root, fixtures } = workerData as { root: string; fixtures: string }
  await mkdir(root, { recursive: true, mode: 0o700 })
  const checks: string[] = [],
    peer = new SyncFixture(),
    workspace = accountWorkspace(42),
    sessions: Array<{
      store: FoundationStore
      account: AccountService
      sync: SyncService
      key: Buffer
      directory: string
      runtimeId: string
    }> = []
  const fixture = JSON.parse(await readFile(join(fixtures, 'sync-v2-vectors.json'), 'utf8'))
  const vectorKey = await unwrap(fixture.password, fixture.envelope, fixture.userId)
  assert.equal(vectorKey.toString('hex'), fixture.dataKeyHex)
  await assert.rejects(unwrap('wrong', fixture.envelope, fixture.userId), code('SYNC_CRYPTO'))
  for (const item of fixture.items) {
    const aad = itemAad(item.userId, item, item.epoch)
    assert.equal(aad.toString(), item.aadUtf8)
    const bytes = open(vectorKey, item.ciphertext, aad)
    assert.equal(bytes.toString(), item.plaintextUtf8)
    bytes.fill(0)
    assert.throws(
      () => open(vectorKey, item.ciphertext, itemAad(item.userId + 1, item, item.epoch)),
      code('SYNC_CRYPTO'),
    )
  }
  const wrapped = await wrap('changed 同步密码', vectorKey, 42, fixture.envelope.revision)
  const again = await unwrap('changed 同步密码', wrapped, 42)
  assert.deepEqual(again, vectorKey)
  again.fill(0)
  vectorKey.fill(0)
  checks.push('固定 Rust 包装、条目与墓碑向量；错误密码/身份篡改拒绝；密码轮换保留数据密钥')
  const master = (await masterCrypto('master.create', { password: 'synthetic-master-password' })) as {
    key: Uint8Array
    keys: MasterKeys
  }
  const sharedKey = Buffer.from(master.key).toString('hex')
  peer.envelope = { ...master.keys, revision: 1 }
  master.key.fill(0)
  const create = (name: string, key = randomBytes(32)) => {
    const directory = join(root, name)
    let initial = new FoundationStore(directory, key, offlineWorkspace)
    if (!initial.local.snapshot().groups.length)
      initial.local.execute('group.create', { request: { name: '原离线分组' } })
    try {
      initial.accounts.session(workspace)
    } catch {
      initial.accounts.save(workspace, {
        user: {
          id: 42,
          email: 'sync@example.invalid',
          emailVerified: true,
          verificationRequired: true,
          storageUsed: 0,
          storageQuota: 100000000,
        },
        tokens: {
          accessToken: 'synthetic-access',
          refreshToken: 'synthetic-refresh',
          expiresAt: Date.now() + 86400000,
        },
        syncEnabled: false,
        cachedSyncKey: { key: sharedKey, revision: 1 },
        masterKeys: { ...master.keys, revision: 1 },
      })
    }
    initial.accounts.activate(workspace)
    initial.close()
    initial = new FoundationStore(directory, key, workspace)
    const store = initial,
      runtimeId = randomUUID()
    const db = {
      call: async (operation: string, input?: unknown) => {
        if (operation.startsWith('sync.storage.')) return store.sync.execute(operation, input)
        if (operation === 'account.storage.session') return store.accounts.session(workspace)
        if (operation === 'account.storage.status') return store.accounts.status(workspace)
        if (operation === 'account.storage.syncSettings')
          return store.accounts.syncSettings(
            workspace,
            input as { syncEnabled?: boolean; cachedSyncKey?: { key: string; revision: number } },
          )
        if (operation === 'account.storage.update') {
          const d = input as { expectedRefreshToken: string; tokens: never }
          return store.accounts.update(workspace, d.expectedRefreshToken, d)
        }
        throw new Error('Unexpected synthetic database call')
      },
    } as unknown as WorkerClient
    const compute = {
      call: async (op: string, input: unknown) => executeCrypto(op, structuredClone(input)),
    } as WorkerClient
    const account = new AccountService(workerAccountStorage(db), peer.transport, workspace, () => undefined)
    const sync = new SyncService(
      db,
      compute,
      account,
      workspace,
      { runtimeId, workspaceId: workspace.id, generation: 1 },
      () => undefined,
    )
    const session = { store, account, sync, key, directory, runtimeId }
    sessions.push(session)
    return session
  }
  const close = async (s: (typeof sessions)[number]) => {
    await s.sync.close()
    await s.account.close()
    s.store.close()
    sessions.splice(sessions.indexOf(s), 1)
  }
  try {
    let a = create('device-a'),
      b = create('device-b')
    const offlineBefore = new FoundationStore(a.directory, a.key, offlineWorkspace)
    const original = offlineBefore.local.snapshot()
    offlineBefore.close()
    assert.equal((await a.sync.status()).unlocked, true)
    assert.equal((await b.sync.status()).unlocked, true)
    assert.equal(
      a.store.accounts.session(workspace)!.cachedSyncKey!.key,
      b.store.accounts.session(workspace)!.cachedSyncKey!.key,
    )
    assert.equal(peer.seq, 0)
    const preview = (await a.sync.execute('sync.preview', { includeOffline: true })) as SyncPreview
    assert.equal(preview.offlineCount, 1)
    assert.equal(preview.accountCount, 0)
    assert.equal(peer.seq, 0)
    await a.sync.execute('sync.bootstrap', { token: preview.token, mode: 'merge' })
    await a.sync.execute('sync.now', undefined)
    const group = a.store.local.snapshot().groups[0]
    assert.equal(peer.seq, 1)
    assert.equal((await a.sync.status()).pendingCount, 0)
    const offlineAfter = new FoundationStore(a.directory, a.key, offlineWorkspace)
    assert.deepEqual(offlineAfter.local.snapshot(), original)
    offlineAfter.close()
    const bp = (await b.sync.execute('sync.preview', { includeOffline: false })) as SyncPreview
    await b.sync.execute('sync.bootstrap', { token: bp.token, mode: 'merge' })
    assert.equal(b.store.local.snapshot().groups[0].id, group.id)
    assert.equal((await b.sync.status()).pendingCount, 0)
    checks.push(
      '注册后两端使用登录缓存的同一 DEK；确认前不上传；默认预览合并离线且保留原库；第二设备应用不回声上传',
    )

    a.store.local.execute('group.update', { id: group.id, request: { name: '上传中旧编辑' } })
    peer.holdPush = async () => {
      peer.holdPush = undefined
      a.store.local.execute('group.update', { id: group.id, request: { name: '上传期间的新编辑' } })
    }
    await a.sync.execute('sync.now', undefined)
    assert.equal(a.store.local.snapshot().groups[0].name, '上传期间的新编辑')
    assert.equal((await a.sync.status()).pendingCount, 1)
    await a.sync.execute('sync.now', undefined)
    assert.equal((await a.sync.status()).pendingCount, 0)
    checks.push('冻结上传后继续编辑；旧确认只清理覆盖修订，新编辑保留并在下一批上传')

    a.store.local.execute('group.create', { request: { name: '提交响应丢失' } })
    peer.dropNextPush = true
    await assert.rejects(a.sync.execute('sync.now', undefined), code('ACCOUNT_UNAVAILABLE'))
    const frozen = a.store.sync.frozen()!,
      pushes = peer.pushBodies.length,
      keyA = a.key
    assert.ok(frozen)
    await close(a)
    a = create('device-a', keyA)
    assert.equal((await a.sync.status()).unlocked, true)
    await a.sync.execute('sync.now', undefined)
    assert.equal(peer.pushBodies.length, pushes)
    assert.equal(a.store.sync.frozen(), null)
    assert.ok((peer.counters[`requests/${frozen.push.requestId}`] ?? 0) > 0)
    a.store.local.execute('group.create', { request: { name: '提交前丢失' } })
    peer.dropBeforePush = true
    await assert.rejects(a.sync.execute('sync.now', undefined), code('ACCOUNT_UNAVAILABLE'))
    await a.sync.execute('sync.now', undefined)
    assert.equal(peer.pushBodies.at(-1), peer.pushBodies.at(-2))
    checks.push('提交响应丢失、重启恢复先查原请求；确认不存在后逐字节重发相同密文和 requestId')

    peer.pageSize = 1
    peer.snapshotPageSize = 1
    await b.sync.execute('sync.now', undefined)
    a.store.local.execute('group.update', { id: group.id, request: { name: '设备 A 修改' } })
    b.store.local.execute('group.update', { id: group.id, request: { name: '设备 B 修改' } })
    await a.sync.execute('sync.now', undefined)
    await b.sync.execute('sync.now', undefined)
    const conflict = ((await b.sync.execute('sync.conflicts', undefined)) as SyncConflict[]).find(
      (c) => c.itemId === group.id,
    )!
    assert.ok(conflict)
    assert.equal(b.store.local.snapshot().groups.find((g) => g.id === group.id)!.name, '设备 B 修改')
    await assert.rejects(
      b.sync.execute('sync.resolveConflict', {
        itemType: 'group',
        itemId: group.id,
        choice: 'keep_local',
        remoteRevision: conflict.remoteRevision - 1,
      }),
      code('CONFLICT_CHANGED'),
    )
    await b.sync.execute('sync.resolveConflict', {
      itemType: 'group',
      itemId: group.id,
      choice: 'keep_local',
      remoteRevision: conflict.remoteRevision,
    })
    await b.sync.execute('sync.now', undefined)
    await a.sync.execute('sync.now', undefined)
    assert.equal(a.store.local.snapshot().groups.find((g) => g.id === group.id)!.name, '设备 B 修改')
    b.store.local.execute('group.delete', { id: group.id })
    a.store.local.execute('group.update', { id: group.id, request: { name: '删除后的云端修改' } })
    await a.sync.execute('sync.now', undefined)
    await b.sync.execute('sync.now', undefined)
    const deletion = ((await b.sync.execute('sync.conflicts', undefined)) as SyncConflict[]).find(
      (c) => c.itemId === group.id,
    )!
    assert.equal(deletion.localDeleted, true)
    await b.sync.execute('sync.resolveConflict', {
      itemType: 'group',
      itemId: group.id,
      choice: 'use_cloud',
      remoteRevision: deletion.remoteRevision,
    })
    assert.equal(b.store.local.snapshot().groups.find((g) => g.id === group.id)!.name, '删除后的云端修改')
    checks.push('固定水位分页；双端并发编辑、删除冲突保留；选择时复核远端修订并避免覆盖新变化')

    a.store.local.execute('profile.create', {
      request: {
        name: '依赖服务器',
        host: 'synthetic.invalid',
        username: 'root',
        group_id: group.id,
        auth_type: 'agent',
      },
    })
    await a.sync.execute('sync.now', undefined)
    await b.sync.execute('sync.now', undefined)
    const old = peer.items.get(`group:${group.id}`)!,
      state = a.store.sync.execute('sync.storage.state', undefined) as { deviceId: string }
    const deleted = (await executeCrypto('sync.encrypt', {
      user: 42,
      key: Buffer.from(a.store.accounts.session(workspace)!.cachedSyncKey!.key, 'hex'),
      epoch: peer.epoch,
      items: [{ ...old, baseRevision: old.revision, revision: old.revision + 1, deleted: true, value: null }],
    })) as WireItem[]
    const injection = {
      requestId: randomUUID(),
      deviceId: state.deviceId,
      epoch: peer.epoch,
      replace: false,
      expectedSeq: peer.seq,
      items: deleted,
    }
    await peer.handle('/api/sync/v2/push', 'POST', injection, JSON.stringify(injection))
    await b.sync.execute('sync.now', undefined)
    const dependency = ((await b.sync.execute('sync.conflicts', undefined)) as SyncConflict[]).find(
      (c) => c.itemId === group.id,
    )!
    assert.equal(dependency.reason, 'dependency')
    assert.ok(b.store.local.snapshot().groups.find((g) => g.id === group.id))
    const keyB = b.key
    await close(b)
    b = create('device-b', keyB)
    assert.equal(
      ((await b.sync.execute('sync.conflicts', undefined)) as SyncConflict[]).find(
        (c) => c.itemId === group.id,
      )!.reason,
      'dependency',
    )
    const restored = (await executeCrypto('sync.encrypt', {
      user: 42,
      key: Buffer.from(a.store.accounts.session(workspace)!.cachedSyncKey!.key, 'hex'),
      epoch: peer.epoch,
      items: [
        {
          ...deleted[0],
          baseRevision: deleted[0].revision,
          revision: deleted[0].revision + 1,
          deleted: false,
          value: a.store.local.snapshot().groups.find((g) => g.id === group.id),
        },
      ],
    })) as WireItem[]
    const repair = { ...injection, requestId: randomUUID(), expectedSeq: peer.seq, items: restored }
    await peer.handle('/api/sync/v2/push', 'POST', repair, JSON.stringify(repair))
    await b.sync.execute('sync.now', undefined)
    await a.sync.execute('sync.now', undefined)
    assert.equal(((await b.sync.execute('sync.conflicts', undefined)) as SyncConflict[]).length, 0)
    checks.push('不合法依赖删除保留有效图并持久化冲突；重启保留，后续合法关联修改可恢复')

    const local = b.store.local.execute('group.create', { request: { name: '游标过期时本地修改' } }) as {
      id: string
    }
    a.store.local.execute('group.create', { request: { name: '游标过期后的云端变化' } })
    await a.sync.execute('sync.now', undefined)
    peer.expiredBefore = peer.seq
    await b.sync.execute('sync.now', undefined)
    assert.ok(b.store.local.snapshot().groups.find((g) => g.id === local.id))
    peer.expiredBefore = 0
    const beforeKey = a.store.accounts.session(workspace)!.cachedSyncKey!.key
    const rotated = (await masterCrypto('master.create', {
      password: 'rotated-master-password',
      keys: master.keys,
      parameters: { cryptoId: master.keys.cryptoId, salt: randomBytes(16).toString('base64') },
      key: Buffer.from(beforeKey, 'hex'),
    })) as { key: Uint8Array; keys: MasterKeys }
    await assert.rejects(
      masterCrypto('master.open', { password: 'synthetic-master-password', keys: rotated.keys }),
      code('SYNC_CRYPTO'),
    )
    const reopened = (await masterCrypto('master.open', {
      password: 'rotated-master-password',
      keys: rotated.keys,
    })) as { key: Uint8Array }
    assert.equal(Buffer.from(reopened.key).toString('hex'), beforeKey)
    rotated.key.fill(0)
    reopened.key.fill(0)
    checks.push('游标过期快照保留待同步；主密码轮换重新包装同一 DEK，旧密码无法解包')

    const stale = (await a.sync.execute('sync.preview', { includeOffline: true })) as SyncPreview
    const offlineEdit = new FoundationStore(a.directory, a.key, offlineWorkspace)
    offlineEdit.local.execute('group.create', { request: { name: '预览后离线库变化' } })
    offlineEdit.close()
    await assert.rejects(
      a.sync.execute('sync.bootstrap', { token: stale.token, mode: 'merge' }),
      code('PREVIEW_CHANGED'),
    )
    const staleLocal = (await a.sync.execute('sync.preview', { includeOffline: false })) as SyncPreview
    a.store.local.execute('group.create', { request: { name: '预览后账号库变化' } })
    await assert.rejects(
      a.sync.execute('sync.bootstrap', { token: staleLocal.token, mode: 'merge' }),
      code('PREVIEW_CHANGED'),
    )
    await a.sync.execute('sync.now', undefined)
    await b.sync.execute('sync.now', undefined)
    const replace = (await a.sync.execute('sync.preview', { includeOffline: false })) as SyncPreview
    const epoch = peer.epoch
    await a.sync.execute('sync.bootstrap', { token: replace.token, mode: 'use_local' })
    const replacement = a.store.sync.frozen()!
    assert.equal(replacement.push.replace, true)
    assert.equal(replacement.push.expectedSeq, peer.seq)
    assert.ok(replacement.push.items.every((i) => i.epoch === epoch + 1))
    const bGroup = b.store.local.snapshot().groups[0]
    b.store.local.execute('group.update', { id: bGroup.id, request: { name: '整体替换期间本地编辑' } })
    await a.sync.execute('sync.now', undefined)
    assert.equal(peer.epoch, epoch + 1)
    await b.sync.execute('sync.now', undefined)
    assert.equal(
      b.store.local.snapshot().groups.find((g) => g.id === bGroup.id)!.name,
      '整体替换期间本地编辑',
    )
    checks.push(
      '预览绑定离线及账号本地修订；整体替换携带完整集合、水位和下一 epoch 密文；其他设备核对时保留本地编辑',
    )

    const many: Array<{ itemType: 'group'; itemId: string; revision: number; epoch: number; value: null }> =
      Array.from({ length: 10001 }, (_, i) => ({
        itemType: 'group',
        itemId: `over-limit-${i}`,
        revision: 1,
        epoch: peer.epoch,
        value: null,
      }))
    const over = a.store.sync.preview(a.runtimeId, peer.seq, peer.epoch, many, false)
    assert.throws(() => a.store.sync.replacement(over.token, a.runtimeId), code('SYNC_REPLACE_TOO_LARGE'))
    const tx = new Database(join(a.directory, 'workspaces', workspace.id, 'workspace.sqlite'))
    const before = a.store.local.snapshot(),
      cursor = (await a.sync.status()).cursor
    tx.exec(
      "CREATE TRIGGER sync_apply_failure BEFORE INSERT ON audit WHEN NEW.action='sync_remote_apply' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END",
    )
    assert.throws(() =>
      a.store.sync.apply(
        [
          {
            itemType: 'group',
            itemId: 'rolled-back-remote',
            revision: 1,
            epoch: peer.epoch,
            value: {
              id: 'rolled-back-remote',
              name: '不应保留',
              icon: 'folder',
              sort_order: 0,
              created_at: '2026-10-28',
            },
          },
        ],
        cursor,
        peer.epoch,
      ),
    )
    tx.exec('DROP TRIGGER sync_apply_failure')
    tx.close()
    assert.deepEqual(a.store.local.snapshot(), before)
    assert.equal((await a.sync.status()).cursor, cursor)
    checks.push('超限整体替换明确拒绝且不拆分；远端业务/审计/影子/冲突/游标事务中途失败整体回滚')
    const raw = await readFile(join(a.directory, 'workspaces', workspace.id, 'workspace.sqlite'))
    assert.equal(raw.includes(Buffer.from('轮换后的同步密码')), false)
    assert.equal(raw.includes(Buffer.from(beforeKey)), false)
    return {
      passed: true,
      synthetic: true,
      realBackend: false,
      realDualDevice: false,
      checks,
      devices: 2,
      fixedCryptoVectors: true,
      rememberedUnlock: true,
      unknownRequestRecovery: true,
      oldAckPreservesNewEdits: true,
      noRemoteEcho: true,
      dependencyConflicts: true,
      atomicCursor: true,
      replaceLimit: true,
    }
  } finally {
    for (const session of [...sessions]) {
      await close(session)
      session.key.fill(0)
    }
  }
}
parentPort!.on('message', async (message) => {
  parentPort!.postMessage(
    await answerWorker(message, async (op) => {
      if (op === 'verify') return verify()
      if (op === 'close') return
    }),
  )
})
