import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import ssh2 from 'ssh2'
import { failureOf } from '@eizhu/contracts'
import { SshConnection } from './connection.ts'
import type { ConnectionHop } from './plan.ts'

const { Server, utils } = ssh2
const key = utils.generateKeyPairSync('ed25519')
const plan = (port: number): ConnectionHop[] => [
  {
    profile: {
      id: 'test',
      name: '测试服务器',
      host: '127.0.0.1',
      port,
      username: 'user',
      auth_type: 'password',
      sort_order: 0,
      tags: [],
      options: '{}',
      note: '',
      created_at: '',
      updated_at: '',
    },
    credential: { password: 'synthetic-secret' },
    proxy: { type: 'direct' },
    timeout: 1000,
    keepalive: 1000,
  },
]
const listen = (server: net.Server) =>
  new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      resolve(address.port)
    })
  })

test('refused TCP connections report the port failure before any host-key or authentication stage', async () => {
  const server = net.createServer(),
    port = await listen(server)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  const connection = new SshConnection(),
    stages: string[] = []
  try {
    await assert.rejects(
      connection.connect(plan(port), {
        verify: async () => true,
        authenticate: async () => [],
        disconnected: () => {},
        stage: (stage) => stages.push(stage),
      }),
      (cause) => failureOf(cause).code === 'SSH_CONNECTION_REFUSED',
    )
    assert.deepEqual(stages, ['resolve', 'establishing_ssh'])
  } finally {
    await connection.close()
  }
})

for (const scenario of ['success', 'authentication', 'hostkey'] as const) {
  test(`SSH stages and sanitized diagnostics follow the real ${scenario} handshake`, async () => {
    const server = new Server({ hostKeys: [key.private] }, (client) => {
      client.on('error', () => {})
      client.on('authentication', (context) => {
        if (scenario === 'success' && context.method === 'password') context.accept()
        else context.reject(['password'])
      })
    })
    const connection = new SshConnection(),
      port = await listen(server)
    const logs: Array<{ stage: string; message: string }> = []
    try {
      const pending = connection.connect(plan(port), {
        verify: async () => scenario !== 'hostkey',
        authenticate: async () => [],
        disconnected: () => {},
        stage: (stage, message) => logs.push({ stage, message }),
      })
      if (scenario === 'success') await pending
      else
        await assert.rejects(
          pending,
          (cause) =>
            failureOf(cause).code === (scenario === 'hostkey' ? 'HOST_KEY_REJECTED' : 'SSH_AUTH_FAILED'),
        )
      assert.deepEqual(
        logs.map((log) => log.stage),
        scenario === 'hostkey'
          ? ['resolve', 'establishing_ssh', 'host_key']
          : ['resolve', 'establishing_ssh', 'host_key', 'ssh_auth'],
      )
      assert.ok(logs[0].message.includes(`127.0.0.1:${port}`))
      assert.ok(!JSON.stringify(logs).includes('synthetic-secret'))
    } finally {
      await connection.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}
