import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ArchiveService } from './service.ts'
import { defaults, type Provider } from './repository.ts'
import type { WorkerClient } from '../workers/client.ts'
import type { HttpRequest, Transport } from './network.ts'

async function fixture(targets: Provider[] = []) {
  const directory = await mkdtemp(join(tmpdir(), 'eizhu-backup-service-'))
  const requests: HttpRequest[] = [],
    objects = new Map<string, Buffer>()
  const results: Array<{ error: string | null }> = []
  const database = {
    call: async (operation: string, input: unknown) => {
      switch (operation) {
        case 'archive.capture':
          return { payload: {}, password: 'synthetic-password', revision: 1, directory }
        case 'archive.providers':
          return targets
        case 'archive.identity':
          return 'test-space'
        case 'archive.recordBackup':
          return
        case 'archive.recordResult':
          results.push(input as { error: string | null })
          return
        case 'backup.getSettings':
          return defaults
        case 'archive.revision':
          return 1
        case 'archive.lastBackup':
          return null
        case 'archive.backedRevision':
          return 1
        default:
          assert.fail(operation)
      }
    },
  } as unknown as WorkerClient
  const compute = {
    call: async () => ({ bytes: Buffer.from('encrypted portable backup') }),
  } as unknown as WorkerClient
  const transport: Transport = async (request) => {
    requests.push(request)
    if (request.url.includes('/bad/')) return { status: 503, headers: {}, body: new Uint8Array() }
    if (request.method === 'PUT') objects.set(request.url, Buffer.from(request.body!))
    return { status: 200, headers: {}, body: objects.get(request.url) ?? new Uint8Array() }
  }
  const service = new ArchiveService(database, compute, transport)
  return {
    directory,
    requests,
    results,
    service,
    close: async () => {
      await service.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}
const target = (id: string, endpoint: string): Provider => ({
  meta: { id, name: 'synthetic', type: 'webdav', enabled: true, created_at: '', updated_at: '' },
  config: { type: 'webdav', name: 'synthetic', enabled: true, endpoint },
  revision: 1,
})

test('without cloud targets a complete backup is saved locally with no network traffic', async () => {
  const f = await fixture()
  try {
    const result = await f.service.execute('backup.backupNow', undefined)
    assert.deepEqual(result, {
      path: join(f.directory, (await readdir(f.directory))[0]),
      uploaded: 0,
      failed: 0,
    })
    assert.equal(f.requests.length, 0)
    assert.deepEqual(f.results, [{ error: null }])
  } finally {
    await f.close()
  }
})
test('enabled targets receive the same new file; no cloud history is queried and failed targets preserve the local file', async () => {
  const f = await fixture([
    target('good', 'https://example.invalid/good'),
    target('bad', 'https://example.invalid/bad'),
  ])
  try {
    const result = await f.service.execute('backup.backupNow', undefined)
    assert.ok(result && typeof result === 'object' && 'path' in result && typeof result.path === 'string')
    assert.equal(await readFile(result.path, 'utf8'), 'encrypted portable backup')
    assert.deepEqual(result, { path: result.path, uploaded: 1, failed: 1 })
    assert.match(f.results[0].error!, /本地备份已保存/)
    assert.ok(
      f.requests.every(
        (request) =>
          request.method !== 'DELETE' &&
          !request.url.includes('index.json') &&
          !request.url.includes('/v000'),
      ),
    )
    const uploaded = f.requests.find((request) => request.method === 'PUT' && request.url.includes('/good/'))!
    assert.deepEqual(Buffer.from(uploaded.body!), await readFile(result.path))
  } finally {
    await f.close()
  }
})
