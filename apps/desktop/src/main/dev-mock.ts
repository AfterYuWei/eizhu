import { basename, join, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { account, offlineWorkspace, syncStatusSchema } from '@eizhu/contracts'
import type { SyncPreview } from '@eizhu/contracts'
import { AccountService } from '@eizhu/core/account/service'
import { workerAccountStorage } from '@eizhu/core/account/storage'
import { WorkerClient } from '@eizhu/core/workers/client'
import { entries } from '@eizhu/core/sync/model'
import type { Remote, WireItem } from '@eizhu/core/sync/model'
import type { Payload } from '@eizhu/core/local/model'
import type { AccountFixture } from './account-fixture-server.ts'
import { createDevMockData, devMockIds, devMockLogin } from './dev-mock-data.ts'

/** Seed through existing database/compute Workers, before the normal runtime opens either workspace. */
export async function seedDevMock(root: string, directory: string, key: Buffer, fixture: AccountFixture) {
  if (!basename(root).startsWith('eizhu-dev-mock-') || !realpathSync(root).startsWith(realpathSync(tmpdir()) + sep))
    throw new Error('Mock data requires a fresh isolated temporary profile')
  const data = createDevMockData()
  const compute = new WorkerClient(join(directory, 'compute.cjs'), {})
  let database = new WorkerClient(join(directory, 'database.cjs'), { root, key, workspace: offlineWorkspace })
  let provider = new AccountService(workerAccountStorage(database), fixture.transport, offlineWorkspace, () => undefined, compute)
  let syncKey: Buffer | undefined
  const importPayload = async (payload: Payload) => {
    const current = await database.call<Payload>('local.snapshot')
    if (Object.values(current).some((rows) => rows.length)) throw new Error('Mock seeding refuses an existing workspace')
    const preview = await database.call<{ token: string }>('backup.prepare', { payload, mode: 'plain', exportedAt: new Date().toISOString() })
    await database.call('backup.apply', { token: preview.token, strategy: 'skip' })
  }
  try {
    await importPayload(data.offline)
    const challenge = account['account.requestRegistrationCode'].output.parse(await provider.execute('account.requestRegistrationCode', { email: devMockLogin.email }))
    const verified = account['account.verifyRegistrationCode'].output.parse(await provider.execute('account.verifyRegistrationCode', { email: devMockLogin.email, challengeId: challenge.challengeId, code: '123456' }))
    const authenticated = await provider.authenticate('account.register', { ...devMockLogin, ticket: verified.ticket })
    const workspace = authenticated.workspace
    const session = await workerAccountStorage(database).session(workspace)
    if (!session?.cachedSyncKey) throw new Error('Mock account did not create its synthetic sync key')
    syncKey = Buffer.from(session.cachedSyncKey.key, 'hex')
    await provider.close()
    await database.close()
    database = new WorkerClient(join(directory, 'database.cjs'), { root, key, workspace })
    provider = new AccountService(workerAccountStorage(database), fixture.transport, workspace, () => undefined, compute)
    await provider.execute('account.updateProfile', { username: 'Mock 测试账号（本机模拟）', avatar: '' })
    await importPayload(data.account)
    await database.call('snippet.delete', { id: devMockIds.snippetDeleted })
    const peer = fixture.sync(workspace.userId)
    const remote: Remote[] = entries(data.cloud).map((item) => ({ ...item, revision: 1, epoch: 1 }))
    remote.push({ itemType: 'profile', itemId: devMockIds.cloudDeleted, value: null, revision: 1, epoch: 1 })
    const encrypted = await compute.call<WireItem[]>('sync.encrypt', {
      key: Buffer.from(syncKey), user: workspace.userId, epoch: 1,
      items: remote.map((item) => ({ ...item, baseRevision: 0, generation: 1, deleted: !item.value, payload: 'pending', keyVersion: 1 })),
    })
    peer.seq = 1
    for (const item of encrypted) peer.items.set(`${item.itemType}:${item.itemId}`, item)
    peer.batches.push({ seq: 1, epoch: 1, requestId: randomUUID(), deviceId: randomUUID(), items: encrypted })
    const runtimeId = randomUUID()
    const preview = await database.call<SyncPreview>('sync.storage.preview', { runtimeId, seq: 1, epoch: 1, remote, includeOffline: false })
    await database.call('sync.storage.bootstrap', { token: preview.token, runtimeId, mode: 'merge' })
    await database.call('account.storage.syncSettings', { syncEnabled: false })
    await database.call('account.storage.commit', { target: workspace })
    const status = syncStatusSchema.parse(await database.call('sync.storage.status', { enabled: false, unlocked: true }))
    if (status.conflictCount !== 6 || !status.initialized || status.status !== 'paused')
      throw new Error('Mock conflict scenarios were not prepared correctly')
    return { conflicts: status.conflictCount, pending: status.pendingCount, localServers: data.account.profiles.length + 2, offlineServers: data.offline.profiles.length }
  } finally {
    syncKey?.fill(0)
    await provider.close()
    await database.close()
    await compute.close()
  }
}
