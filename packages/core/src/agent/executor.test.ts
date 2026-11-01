import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import ssh2 from 'ssh2'
import type { Connection } from 'ssh2'
import type { AddressInfo } from 'node:net'
import { executeAgentCommand, shellQuote } from './executor.ts'
const { Client, Server, utils } = ssh2

test('SSH execution preserves exact quoted command/cwd, stdout/stderr, limits output, and reports unknown outcomes', async () => {
  const peers = new Set<Connection>(),
    received: string[] = []
  const server = new Server({ hostKeys: [utils.generateKeyPairSync('ed25519').private] }, (peer) => {
    peers.add(peer)
    peer.on('error', () => undefined)
    peer.once('close', () => peers.delete(peer))
    peer.on('authentication', (ctx) => ctx.accept())
    peer.on('ready', () =>
      peer.on('session', (accept) => {
        const s = accept()
        s.on('exec', (accept, _reject, info) => {
          received.push(info.command)
          const c = accept()
          c.on('error', () => undefined)
          if (info.command.includes('wait-forever')) return
          if (info.command.includes('no-exit')) {
            c.end('partial')
            return
          }
          c.write('中文 🧪\n')
          c.stderr.write('warning\n')
          if (info.command.includes('large-output')) c.write(Buffer.alloc(300000, 65))
          c.exit(9)
          c.end()
        })
      }),
    )
  })
  const client = new Client()
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const ready = once(client, 'ready')
    client.connect({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, username: 'synthetic' })
    await ready
    const cwd = "/tmp/中文 ' $HOME",
      command = "printf '%s' '$(no-execution)'"
    const result = await executeAgentCommand(
      client,
      command,
      cwd,
      2,
      new AbortController().signal,
      () => undefined,
    )
    assert.equal(result.status, 'completed')
    assert.equal(result.exitCode, 9)
    assert.equal(result.stdout, '中文 🧪\n')
    assert.equal(result.stderr, 'warning\n')
    assert.equal(received[0], `cd -- ${shellQuote(cwd)} && exec sh -c ${shellQuote(command)}`)
    const large = await executeAgentCommand(
      client,
      'large-output',
      '/tmp',
      2,
      new AbortController().signal,
      () => undefined,
    )
    assert.ok(large.truncated)
    assert.ok(Buffer.byteLength(large.stdout + large.stderr) <= 262144)
    const unknown = await executeAgentCommand(
      client,
      'no-exit',
      '/tmp',
      2,
      new AbortController().signal,
      () => undefined,
    )
    assert.equal(unknown.status, 'unknown')
    assert.equal(unknown.exitCode, null)
    const cancel = new AbortController()
    const pending = executeAgentCommand(client, 'wait-forever', '/tmp', 2, cancel.signal, () => undefined)
    setTimeout(() => cancel.abort(), 30)
    assert.equal((await pending).status, 'unknown')
    const timeout = await executeAgentCommand(
      client,
      'wait-forever',
      '/tmp',
      1,
      new AbortController().signal,
      () => undefined,
    )
    assert.equal(timeout.status, 'unknown')
    assert.match(timeout.message, /超时/)
  } finally {
    client.end()
    for (const peer of peers) peer.end()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
