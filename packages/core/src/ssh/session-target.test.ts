import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ssh2 from 'ssh2'
import type { Connection } from 'ssh2'
import { ssh } from '@eizhu/contracts'
import type { SessionCreateResponse } from '@eizhu/contracts/models/session'
import { SshService } from './service.ts'
import { WorkerClient } from '../workers/client.ts'

/** Two distinct real SSH peers; only configuration storage is an isolated Worker fixture. */
test(
  'SSH sessions isolate A/B, reject stale targets before dialing and report actual connection metadata',
  { timeout: 15000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'eizhu-session-target-'))
    const key = ssh2.utils.generateKeyPairSync('ed25519')
    const parsedKey = ssh2.utils.parseKey(key.private)
    assert.ok(!(parsedKey instanceof Error) && !Array.isArray(parsedKey))
    const fingerprint =
      'SHA256:' + createHash('sha256').update(parsedKey.getPublicSSH()).digest('base64').replace(/=+$/, '')
    const clients = new Set<Connection>(),
      inputs: string[][] = [[], []],
      connections = [0, 0]
    const servers = [0, 1].map(
      (index) =>
        new ssh2.Server({ hostKeys: [key.private] }, (client) => {
          clients.add(client)
          connections[index]++
          client.on('error', () => undefined)
          client.once('close', () => clients.delete(client))
          client.on('authentication', (context) => context.accept())
          client.on('ready', () =>
            client.on('session', (accept) => {
              const session = accept()
              session.on('pty', (accept) => accept?.())
              session.on('shell', (accept) => {
                const channel = accept()
                channel.on('error', () => undefined)
                channel.write(`server-${index}\r\n`)
                channel.on('data', (data: Buffer) => inputs[index].push(data.toString()))
              })
              // Unsupported shell: readiness still comes from the actual SSH peer.
              session.on('exec', (accept) => {
                const channel = accept()
                channel.exit(0)
                channel.end('/unsupported-shell\n')
              })
            }),
          )
        }),
    )
    let database: WorkerClient | undefined, service: SshService | undefined
    try {
      const ports = await Promise.all(
        servers.map(
          (server) =>
            new Promise<number>((resolve, reject) => {
              server.once('error', reject)
              server.listen(0, '127.0.0.1', () => {
                const address = server.address()
                assert.ok(address && typeof address !== 'string')
                resolve(address.port)
              })
            }),
        ),
      )
      const worker = join(root, 'database.mjs')
      await writeFile(
        worker,
        `import { parentPort, workerData } from 'node:worker_threads';
      import { connectionPlan } from ${JSON.stringify(new URL('./plan.ts', import.meta.url).href)};
      import { answerWorker } from ${JSON.stringify(new URL('../workers/client.ts', import.meta.url).href)};
      const profiles = workerData.ports.map((port, index) => ({ id: String(index), name: 'server-' + index,
        host: '127.0.0.1', port, username: 'user', auth_type: 'password', inline_credential: { password: 'synthetic' },
        sort_order: 0, tags: [], options: '{}', note: '', created_at: '', updated_at: '' }));
      parentPort.on('message', async message => parentPort.postMessage(await answerWorker(message, (operation, input) => {
        if (operation === 'ssh.plan') return connectionPlan({ profiles, groups: [],
          vault: [{ id: 'vault', name: 'vault', type: 'password', username: 'vault-user', credential: { password: 'synthetic-vault' }, remark: '', fingerprint: '', created_at: '', updated_at: '' }], snippets: [] }, input);
        if (operation === 'profile.get') return profiles.find(p => p.id === input.id);
        if (operation === 'test.edit') return Object.assign(profiles[0], input);
        if (operation === 'ssh.known') return workerData.fingerprint;
        if (operation === 'close') return;
        throw new Error('Unexpected fixture operation');
      })));`,
      )
      database = new WorkerClient(worker, { ports, fingerprint })
      service = new SshService(
        database,
        database,
        { runtimeId: 'test', workspaceId: 'account:42', generation: 1 },
        () => undefined,
      )
      const state = async (id: string, status: string) => {
        for (let attempt = 0; attempt < 200; attempt++) {
          const messages = ssh['session.attach'].output.parse(
            await service!.execute('session.attach', { id }),
          )
          const connection = messages.find((message) => message.type === 'connection_state')
          const meta = messages.find((message) => message.type === 'metadata')
          if (connection?.type === 'connection_state' && connection.payload.status === status)
            return {
              connection: connection.payload,
              meta: meta?.type === 'metadata' ? meta.payload : undefined,
            }
          if (status !== 'error')
            assert.notEqual(
              connection?.type === 'connection_state' && connection.payload.status,
              'error',
              JSON.stringify(connection),
            )
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        throw new Error('SSH fixture did not become ready')
      }
      const expected = { host: '127.0.0.1', port: ports[0] }
      const a = (await service.execute('session.create', {
        request: { profile_id: '0', expected_target: expected },
      })) as SessionCreateResponse
      const b = (await service.execute('session.create', {
        request: { profile_id: '1' },
      })) as SessionCreateResponse
      const [readyA, readyB] = await Promise.all([
        state(a.session_id, 'connected'),
        state(b.session_id, 'connected'),
      ])
      assert.equal(readyA.meta?.port, ports[0])
      assert.equal(readyB.meta?.profile_id, '1')
      await service.execute('session.input', { id: a.session_id, data: 'input-a\r' })
      await service.execute('session.input', { id: b.session_id, data: 'input-b\r' })
      for (let attempt = 0; attempt < 100 && (!inputs[0].length || !inputs[1].length); attempt++)
        await new Promise((resolve) => setTimeout(resolve, 10))
      assert.deepEqual(inputs, [['input-a\r'], ['input-b\r']])
      assert.deepEqual(connections, [1, 1])
      await database.call('test.edit', {
        auth_type: 'vault',
        vault_id: 'vault',
        username: 'stale-stored-user',
      })
      await service.execute('session.reconnect', { id: a.session_id })
      assert.equal((await state(a.session_id, 'connected')).meta?.username, 'vault-user')
      assert.deepEqual(connections, [2, 1])
      await database.call('test.edit', { name: 'edited-a', port: ports[1], username: 'edited-user' })
      await service.execute('session.reconnect', { id: a.session_id })
      assert.equal((await state(a.session_id, 'error')).connection.error_code, 'PROFILE_CHANGED')
      const stale = (await service.execute('session.create', {
        request: { profile_id: '0', expected_target: expected },
      })) as SessionCreateResponse
      assert.equal((await state(stale.session_id, 'error')).connection.error_code, 'PROFILE_CHANGED')
      assert.deepEqual(connections, [2, 1])
      const fresh = (await service.execute('session.create', {
        request: {
          profile_id: '0',
          expected_target: { ...expected, port: ports[1] },
        },
      })) as SessionCreateResponse
      const actual = await state(fresh.session_id, 'connected')
      assert.deepEqual(actual.meta, {
        session_id: fresh.session_id,
        profile_id: '0',
        profile_name: 'edited-a',
        host: '127.0.0.1',
        port: ports[1],
        username: 'vault-user',
        protocol: 'ssh',
      })
      assert.deepEqual(actual.connection.target, {
        profile_id: '0',
        profile_name: 'edited-a',
        host: '127.0.0.1',
        port: ports[1],
        username: 'vault-user',
      })
      assert.deepEqual(connections, [2, 2])
    } finally {
      await service?.close()
      await database?.close()
      for (const client of clients) client.end()
      await Promise.all(
        servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
      )
      await rm(root, { recursive: true, force: true })
    }
  },
)
