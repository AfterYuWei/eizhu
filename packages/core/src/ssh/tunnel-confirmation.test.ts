import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopError } from '@eizhu/contracts'
import type { TunnelConfig } from '@eizhu/contracts/models/api'
import { SshService } from './service.ts'
import { WorkerClient } from '../workers/client.ts'

const config: TunnelConfig = { id: 'public', name: 'web', profile_id: 'p', kind: 'local', bind_host: '0.0.0.0', bind_port: 9000, target_host: '127.0.0.1', target_port: 80 }
async function fixture(configs: TunnelConfig[]) {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-tunnel-confirm-'))
  const worker = join(root, 'database.mjs')
  // Deliberately refuse the SSH plan: tests can prove the confirmation gate runs before connection setup.
  await writeFile(worker, `import { parentPort, workerData } from 'node:worker_threads';
    parentPort.on('message', ({id,operation}) => parentPort.postMessage(operation === 'tunnel.list'
      ? {id,value:workerData} : {id,error:{code:'TEST_PLAN_REACHED',message:'Test connection boundary'}}));`)
  const database = new WorkerClient(worker, configs)
  const events: unknown[] = []
  const service = new SshService(database, database, { runtimeId: 'test', workspaceId: 'offline', generation: 1 }, (_name, value) => { events.push(value) })
  return { service, events, close: async () => { await service.close(); await database.close(); await rm(root, { recursive: true, force: true }) } }
}

test('all public modes reject unconfirmed starts before any connection state or SSH plan', async () => {
  const configs = ['0.0.0.0', '::'].flatMap((bind_host) => (['local', 'remote', 'dynamic'] as const).map((kind) => ({ ...config, id: bind_host + kind, bind_host, kind })))
  const f = await fixture(configs)
  try {
    for (const c of configs) await assert.rejects(f.service.execute('tunnel.start', { id: c.id }), (e) => e instanceof DesktopError && e.error.code === 'TUNNEL_PUBLIC_CONFIRM_REQUIRED')
    assert.deepEqual(f.events, [])
    const states = await f.service.execute('tunnel.statuses', undefined)
    assert.ok(Array.isArray(states) && states.every((s) => s.status === 'stopped'))
  } finally { await f.close() }
})

test('a public confirmation is bound to every reviewed configuration field', async () => {
  const f = await fixture([config])
  try {
    const changes = [{ id: 'other' }, { name: 'changed' }, { profile_id: 'other' }, { kind: 'remote' }, { bind_host: '::' }, { bind_port: 9001 }, { target_host: 'other.example' }, { target_port: 81 }]
    for (const change of changes)
      await assert.rejects(f.service.execute('tunnel.start', { id: config.id, confirmedConfig: { ...config, ...change } }), (e) => e instanceof DesktopError && e.error.code === 'TUNNEL_CONFIG_CHANGED')
    assert.deepEqual(f.events, [])
  } finally { await f.close() }
})

test('matching public confirmation reaches connection setup; stop requires fresh confirmation next time', async () => {
  const f = await fixture([config])
  try {
    await f.service.execute('tunnel.start', { id: config.id, confirmedConfig: config })
    await f.service.execute('tunnel.stop', { id: config.id })
    await assert.rejects(f.service.execute('tunnel.start', { id: config.id }), (e) => e instanceof DesktopError && e.error.code === 'TUNNEL_PUBLIC_CONFIRM_REQUIRED')
    assert.ok(f.events.length > 0)
  } finally { await f.close() }
})

test('existing loopback configurations still start without public confirmation', async () => {
  const f = await fixture([{ ...config, bind_host: '127.0.0.1' }])
  try {
    await f.service.execute('tunnel.start', { id: config.id })
    assert.ok(f.events.length > 0)
  } finally { await f.close() }
})
