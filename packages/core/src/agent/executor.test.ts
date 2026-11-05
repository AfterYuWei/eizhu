import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ssh2 from 'ssh2'
import type { Connection, ServerChannel } from 'ssh2'
import type { AddressInfo } from 'node:net'
import { executeAgentCommand, shellQuote } from './executor.ts'
const { Client, Server, utils } = ssh2

async function terminal(serve: (channel: ServerChannel) => void) {
  const peers = new Set<Connection>()
  let execRequests = 0,
    shellRequests = 0
  const server = new Server({ hostKeys: [utils.generateKeyPairSync('ed25519').private] }, (peer) => {
    peers.add(peer)
    peer.on('error', () => undefined)
    peer.once('close', () => peers.delete(peer))
    peer.on('authentication', (ctx) => ctx.accept())
    peer.on('ready', () =>
      peer.on('session', (accept) => {
        const session = accept()
        session.on('pty', (accept) => accept?.())
        session.on('exec', (_accept, reject) => {
          execRequests++
          reject()
        })
        session.on('shell', (accept) => {
          shellRequests++
          const channel = accept()
          channel.on('error', () => undefined)
          serve(channel)
        })
      }),
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const client = new Client(),
    ready = once(client, 'ready')
  client.connect({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, username: 'synthetic' })
  await ready
  const channel = await new Promise<ssh2.ClientChannel>((resolve, reject) =>
    client.shell((error, channel) => (error ? reject(error) : resolve(channel))),
  )
  return {
    channel,
    counts: () => ({ execRequests, shellRequests }),
    close: async () => {
      channel.destroy()
      client.end()
      for (const peer of peers) peer.end()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

test('AI writes to the existing shell, excludes echo/prompt, merges PTY output, and recognizes fragmented completion', async () => {
  const received: string[] = [],
    visible: Buffer[] = []
  const f = await terminal((channel) =>
    channel.on('data', (data: Buffer) => {
      const script = data.toString()
      received.push(script)
      const token = script.match(/eizhuAi;([\w-]+);start/)?.[1]
      if (!token) return
      channel.write(script + '\r\n')
      const bytes = Buffer.from(
        `\x1b]1337;eizhuAi;${token};start\x07中文 🧪\nwarning\n\x1b]1337;eizhuAi;${token};end;9\x07prompt$ `,
      )
      for (const byte of bytes) channel.write(Buffer.from([byte]))
    }),
  )
  f.channel.on('data', (data: Buffer) => visible.push(data))
  try {
    const cwd = "/tmp/中文 ' $HOME",
      command = "printf '%s' '$(no-execution)'\nprintf '\t'"
    const result = await executeAgentCommand(
      f.channel,
      'bash',
      command,
      cwd,
      2,
      new AbortController().signal,
      () => undefined,
    )
    assert.equal(result.status, 'completed')
    assert.equal(result.exitCode, 9)
    assert.equal(result.stdout, '中文 🧪\nwarning\n')
    assert.equal(result.stderr, '')
    assert.ok(received[0].includes(`cd -- ${shellQuote(cwd)} && eval `))
    assert.equal(received[0].slice(0, -1).includes('\n'), false)
    assert.equal(received[0].includes('\t'), false)
    assert.ok(Buffer.concat(visible).toString().includes('中文 🧪'))
    assert.deepEqual(f.counts(), { execRequests: 0, shellRequests: 1 })
    assert.equal(f.channel.destroyed, false)
  } finally {
    await f.close()
  }
})

test('output remains bounded while the shared terminal receives the full stream', async () => {
  let seen = 0
  const f = await terminal((channel) =>
    channel.on('data', (data: Buffer) => {
      const token = data.toString().match(/eizhuAi;([\w-]+);start/)![1]
      channel.write(`\x1b]1337;eizhuAi;${token};start\x07`)
      channel.write('中文🧪'.repeat(40000))
      channel.write(`\x1b]1337;eizhuAi;${token};end;0\x07`)
    }),
  )
  f.channel.on('data', (data: Buffer) => {
    seen += data.length
  })
  try {
    const result = await executeAgentCommand(
      f.channel,
      'zsh',
      'large-output',
      '/tmp',
      3,
      new AbortController().signal,
      () => undefined,
    )
    assert.equal(result.exitCode, 0)
    assert.equal(result.truncated, true)
    assert.ok(Buffer.byteLength(result.stdout) <= 262144)
    assert.ok(seen > 300000)
  } finally {
    await f.close()
  }
})

for (const reason of ['cancel', 'timeout', 'disconnect', 'already-cancelled'] as const) {
  test(`${reason} reports an unknown result without closing or retrying the shared shell`, async () => {
    const received: string[] = []
    const f = await terminal((channel) =>
      channel.on('data', (data: Buffer) => {
        const text = data.toString()
        received.push(text)
        const token = text.match(/eizhuAi;([\w-]+);start/)?.[1]
        if (token) channel.write(`\x1b]1337;eizhuAi;${token};start\x07partial`)
        if (reason === 'disconnect') channel.end()
      }),
    )
    const controller = new AbortController()
    if (reason === 'already-cancelled') controller.abort()
    try {
      const pending = executeAgentCommand(
        f.channel,
        'bash',
        'wait-forever',
        '/tmp',
        1,
        controller.signal,
        () => undefined,
      )
      if (reason === 'cancel') setTimeout(() => controller.abort(), 100)
      const result = await pending
      assert.equal(result.status, 'unknown')
      assert.equal(result.exitCode, null)
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (reason === 'cancel' || reason === 'timeout') {
        assert.equal(f.channel.destroyed, false)
        assert.ok(received.join('').endsWith('\x03'))
      }
      assert.equal(
        received.filter((text) => text.includes('wait-forever')).length,
        reason === 'already-cancelled' ? 0 : 1,
      )
      assert.equal(f.channel.listenerCount('data'), 0)
    } finally {
      await f.close()
    }
  })
}

for (const shell of ['bash', 'zsh', 'fish'] as const) {
  const available = process.platform !== 'win32' && !spawnSync(shell, ['--version'], { timeout: 2000 }).error
  test(
    `${shell}: AI and manual commands share cwd, shell variables, aliases/functions and interactive stdin`,
    { skip: !available },
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'eizhu-agent-shell-'))
      const directory = join(root, "项目 ' $HOME")
      await mkdir(directory)
      const args =
        shell === 'bash'
          ? ['--noprofile', '--norc', '-i']
          : shell === 'zsh'
            ? ['-d', '-f', '-i']
            : ['--no-config', '-i']
      const f = await terminal((channel) => {
        const child = spawn('/bin/sh', ['-c', 'exec "$@" 2>&1', 'eizhu-agent-test', shell, ...args], {
          env: { ...process.env, TERM: 'xterm-256color' },
        })
        channel.on('data', (data: Buffer) => child.stdin.write(data.toString().replaceAll('\r', '\n')))
        child.stdout.on('data', (data: Buffer) => channel.write(data))
      channel.once('close', () => child.kill('SIGKILL'))
        child.once('close', () => channel.end())
      })
      const visible: Buffer[] = []
      f.channel.on('data', (bytes: Buffer) => visible.push(bytes))
      try {
        f.channel.write(
          shell === 'fish'
            ? "set shared manual; function shared_fn; printf 'function:%s\\n' $shared; end; alias shared_alias='printf alias';\r"
            : "shared=manual; shared_fn(){ printf 'function:%s\\n' \"$shared\"; }; alias shared_alias='printf alias';\r",
        )
        const first = await executeAgentCommand(
          f.channel,
          shell,
          "shared_fn\nshared_alias\nprintf '\t中文 🧪\\n'\nfalse",
          directory,
          3,
          new AbortController().signal,
          () => undefined,
        )
        assert.equal(first.exitCode, 1, JSON.stringify(first))
        assert.match(first.stdout, /function:manual\nalias\t中文 🧪\n/)
        const change = shell === 'fish' ? 'set shared agent; cd ..' : 'shared=agent; cd ..'
        const second = await executeAgentCommand(
          f.channel,
          shell,
          change,
          directory,
          3,
          new AbortController().signal,
          () => undefined,
        )
        assert.equal(second.exitCode, 0)
        const third = await executeAgentCommand(
          f.channel,
          shell,
          'pwd; shared_fn',
          await realpath(root),
          3,
          new AbortController().signal,
          () => undefined,
        )
        assert.equal(third.exitCode, 0)
        assert.ok(third.stdout.includes(await realpath(root)))
        assert.ok(third.stdout.includes('function:agent'))
        const interactive = executeAgentCommand(
          f.channel,
          shell,
          shell === 'fish'
            ? "read answer; printf 'answer:%s\\n' $answer"
            : 'read answer; printf \'answer:%s\\n\' "$answer"',
          root,
          3,
          new AbortController().signal,
          () => undefined,
        )
        setTimeout(() => f.channel.write('from-current-terminal\r'), 100)
        assert.match((await interactive).stdout, /answer:from-current-terminal/)
        f.channel.write("printf 'MANUAL_AFTER_AI\\n'\r")
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert.ok(Buffer.concat(visible).toString().includes('MANUAL_AFTER_AI'))
        assert.deepEqual(f.counts(), { execRequests: 0, shellRequests: 1 })
      } finally {
        await f.close()
        await rm(root, { recursive: true, force: true })
      }
    },
  )
}
