import assert from 'node:assert/strict'
import net from 'node:net'
import { Server, utils } from 'ssh2'
import type { Connection, ServerChannel } from 'ssh2'
import type { BrowserWindow } from 'electron'
import type { RuntimeHost } from './runtime-host.ts'
import { SocketReader, proxyHandshake } from '@eizhu/core/ssh/network'

/** Synthetic loopback peers only. Runs in the actual packaged Electron process tree. */
export async function verifyStage3(window: BrowserWindow, runtime: RuntimeHost) {
  const step = (name: string) => console.log('EIZHU_STAGE3_STEP', name)
  const host = utils.generateKeyPairSync('ed25519'),
    clients = new Set<Connection>(),
    usernames = new Map<Connection, string>(),
    resources = new Set<net.Server>(),
    sockets = new Set<net.Socket>()
  const inputs: string[] = [],
    shells = new Set<ServerChannel>(),
    commands: string[] = [],
    sizes: number[] = []
  const fixtureInfo =
    '===HOSTNAME===\nstage3-synthetic\n===OS===\nDebian GNU/Linux\n===OS_ID===\ndebian\n===KERNEL===\n6.1\n===ARCH===\nx86_64\n===CPUS===\n2\n===CPUMHZ===\n2400\n'
  const fixtureMetrics =
    '===CPU1===\nT 10 0 0 90 0 0 0 0\n===CPU2===\nT 30 0 0 170 0 0 0 0\n===NET1===\neth0 1 2\n===NET2===\neth0 101 202\n===STATIC===\nMT 1000\nMU 400\nDU 100\nDT 200\n'
  const tracked = (socket: net.Socket) => {
    sockets.add(socket)
    socket.on('error', () => undefined)
    socket.once('close', () => sockets.delete(socket))
    return socket
  }
  const relay = (a: NodeJS.ReadWriteStream, b: NodeJS.ReadWriteStream) => {
    a.on('error', () => b.end())
    b.on('error', () => a.end())
    a.pipe(b).pipe(a)
  }
  const sshServer = new Server({ hostKeys: [host.private] }, (client) => {
    clients.add(client)
    client.on('error', () => undefined)
    client.once('close', () => clients.delete(client))
    client.on('authentication', (ctx) => {
      usernames.set(client, ctx.username)
      if (ctx.method === 'password' && ctx.password === 'synthetic-password') ctx.accept()
      else if (ctx.method === 'publickey') {
        const key = utils.parseKey(ctx.key.data)
        if (
          !(key instanceof Error) &&
          !Array.isArray(key) &&
          (!ctx.signature || key.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true)
        )
          ctx.accept()
        else ctx.reject()
      } else if (ctx.method === 'keyboard-interactive')
        ctx.prompt([{ prompt: '合成验证码', echo: false }], (responses) => {
          if (responses[0] === '123456') ctx.accept()
          else ctx.reject()
        })
      else ctx.reject(['password', 'publickey', 'keyboard-interactive'])
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        session.on('pty', (accept) => accept?.())
        session.on('window-change', (accept, _reject, info) => {
          sizes.push(info.cols)
          accept?.()
        })
        session.on('shell', (accept) => {
          const stream = accept()
          shells.add(stream)
          stream.on('error', () => undefined)
          stream.once('close', () => shells.delete(stream))
          const greeting = Buffer.from('阶段三 🧪 终端\r\n\x1b]7;file://synthetic/tmp/stage3\x07')
          stream.write(greeting.subarray(0, 2))
          setTimeout(() => stream.write(greeting.subarray(2, 9)), 40)
          setTimeout(() => stream.write(greeting.subarray(9)), 80)
          stream.on('data', (b: Buffer) => {
            inputs.push(b.toString('utf8'))
            if (b.toString() === 'burst') stream.write('B'.repeat(262144) + '\r\nEND_BURST\r\n')
            else stream.write(b)
          })
        })
        session.on('exec', (accept, _reject, info) => {
          commands.push(info.command)
          const stream = accept()
          stream.on('error', () => undefined)
          stream.write(
            info.command.includes('===CPU1===')
              ? fixtureMetrics
              : info.command.includes('===HOSTNAME===')
                ? fixtureInfo
                : 'main\nfeature/stage3\n',
          )
          stream.exit(0)
          stream.end()
        })
        session.on('sftp', (accept) => {
          const sftp = accept()
          let listed = false
          sftp.on('REALPATH', (id: number) =>
            sftp.name(id, [
              {
                filename: '/tmp/stage3',
                longname: '',
                attrs: { mode: 0o040755, size: 0, mtime: 1700000000, atime: 1700000000, uid: 0, gid: 0 },
              },
            ]),
          )
          sftp.on('OPENDIR', (id: number) => {
            listed = false
            sftp.handle(id, Buffer.from('directory'))
          })
          sftp.on('READDIR', (id: number) => {
            if (listed) {
              sftp.status(id, 1)
              return
            }
            listed = true
            sftp.name(id, [
              {
                filename: "中文 ' space.txt",
                longname: '',
                attrs: { mode: 0o100644, size: 42, mtime: 1700000000, atime: 1700000000, uid: 0, gid: 0 },
              },
              {
                filename: '子目录',
                longname: '',
                attrs: { mode: 0o040755, size: 0, mtime: 1700000000, atime: 1700000000, uid: 0, gid: 0 },
              },
            ])
          })
          sftp.on('CLOSE', (id: number) => sftp.status(id, 0))
        })
      })
      client.on('tcpip', (accept, _reject, info) => {
        const channel = accept(),
          socket = tracked(net.connect({ host: info.destIP, port: info.destPort, allowHalfOpen: true }))
        relay(channel, socket)
      })
      const forwards = new Map<number, net.Server>()
      client.on('request', (accept, reject, name, info) => {
        if (name === 'tcpip-forward') {
          const server = net.createServer({ allowHalfOpen: true }, (socket) => {
            tracked(socket)
            client.forwardOut(
              info.bindAddr,
              Number((server.address() as net.AddressInfo).port),
              socket.remoteAddress ?? '127.0.0.1',
              socket.remotePort ?? 0,
              (e, channel) => (e ? socket.destroy() : relay(socket, channel)),
            )
          })
          server.on('error', () => reject?.())
          resources.add(server)
          server.listen(info.bindPort, info.bindAddr, () => {
            const port = (server.address() as net.AddressInfo).port
            forwards.set(port, server)
            accept?.(port)
          })
        } else if (name === 'cancel-tcpip-forward') {
          const server = forwards.get(info.bindPort)
          server?.close(() => accept?.())
          forwards.delete(info.bindPort)
        } else reject?.()
      })
      client.once('close', () => {
        for (const server of forwards.values()) server.close()
      })
    })
  })
  const listen = (server: net.Server | Server) =>
    new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
    })
  const js = <T = unknown>(body: string, data?: unknown): Promise<T> =>
    window.webContents.executeJavaScript(`(async d=>{${body}})(${JSON.stringify(data)})`)
  const wait = async <T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> => {
    const deadline = Date.now() + 15000
    let value: T
    do {
      value = await read()
      if (done(value)) return value
      await new Promise((r) => setTimeout(r, 25))
    } while (Date.now() < deadline)
    throw new Error('Stage 3 condition timeout: ' + JSON.stringify(value))
  }
  const call = <T = unknown>(operation: string, input?: unknown) => runtime.call<T>(operation, input)
  const profileIds: string[] = [],
    tunnelIds: string[] = [],
    sessionIds: string[] = []
  try {
    const port = await listen(sshServer)
    const echo = net.createServer({ allowHalfOpen: true }, (socket) => {
      tracked(socket)
      socket.pipe(socket)
    })
    resources.add(echo)
    const echoPort = await listen(echo)
    const proxy = net.createServer((socket) => {
      tracked(socket)
      const reader = new SocketReader(socket)
      void (async () => {
        let request = ''
        while (!request.endsWith('\r\n\r\n')) {
          request += (await reader.read(1)).toString()
          if (request.length > 8192) throw new Error('Proxy header too long')
        }
        reader.release()
        assert.ok(request.startsWith(`CONNECT 127.0.0.1:${port} `))
        const target = tracked(net.connect(port, '127.0.0.1'))
        socket.write('HTTP/1.1 200 Connection established\r\n\r\n')
        relay(socket, target)
        socket.resume()
      })().catch(() => socket.destroy())
    })
    resources.add(proxy)
    const proxyPort = await listen(proxy)
    const socks = net.createServer((socket) => {
      tracked(socket)
      const reader = new SocketReader(socket)
      void (async () => {
        const hello = await reader.read(3)
        assert.equal(hello[0], 5)
        socket.write(Buffer.from([5, 0]))
        const head = await reader.read(4)
        const n = head[3] === 1 ? 4 : head[3] === 4 ? 16 : (await reader.read(1))[0]
        await reader.read(n)
        const targetPort = (await reader.read(2)).readUInt16BE()
        reader.release()
        const target = tracked(net.connect(targetPort, '127.0.0.1'))
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
        relay(socket, target)
        socket.resume()
      })().catch(() => socket.destroy())
    })
    resources.add(socks)
    const socksPort = await listen(socks)
    await js(`window.__stage3={output:'',states:[],messages:[],wrong:false};`)
    const newProfile = async (request: Record<string, unknown>) => {
      const p = await call<{ id: string }>('profile.create', {
        request: {
          name: '阶段 3 合成服务',
          host: '127.0.0.1',
          port,
          username: 'synthetic',
          auth_type: 'password',
          password: 'synthetic-password',
          ...request,
        },
      })
      profileIds.push(p.id)
      return p.id
    }
    const open = async (profile_id: string, decision = 'trust_permanently') => {
      const created = await call<{ session_id: string }>('session.create', { request: { profile_id } })
      sessionIds.push(created.session_id)
      await js(
        `const api=window.eizhu;const state=window.__stage3;return api.session.subscribe({id:d.id},async message=>{
        state.messages.push(message);if(message.type==='output'){state.output+=message.data;await new Promise(r=>setTimeout(r,2))}
        if(message.type==='connection_state'){state.states.push(message.payload);if(message.payload.waiting_for_host_key){const p=message.payload;state.wrong=await api.session.decide({requestId:p.host_key_request_id,fingerprint:'SHA256:wrong',decision:'trust_once'}).then(()=>false,e=>e.code==='STALE_CONFIRMATION');await api.session.decide({requestId:p.host_key_request_id,fingerprint:p.host_key_fingerprint,decision:d.decision})}}
        if(message.type==='auth_request')await api.session.authRespond({requestId:message.payload.request_id,responses:['123456']});
      });`,
        { id: created.session_id, decision },
      )
      await wait(
        () => call<Array<{ id: string; status: string }>>('session.list'),
        (rows) => rows.some((r) => r.id === created.session_id && r.status === 'connected'),
      )
      return created.session_id
    }
    step('peers-listening')
    const direct = await newProfile({}),
      id = await open(direct)
    await wait(
      () => js<string>('return window.__stage3.output'),
      (value) => value.includes('阶段三 🧪 终端'),
    )
    assert.equal(await js('return window.__stage3.wrong'), true)
    const current = await js<{ host_key_request_id: string; host_key_fingerprint: string }>(
      'return window.__stage3.states.find(s=>s.waiting_for_host_key)',
    )
    assert.equal(
      await js(
        "return window.eizhu.session.decide({requestId:d.host_key_request_id,fingerprint:d.host_key_fingerprint,decision:'trust_once'}).then(()=>false,e=>e.code==='STALE_CONFIRMATION')",
        current,
      ),
      true,
    )
    step('host-key-and-utf8-passed')
    await call('session.input', { id, data: 'burst' })
    await wait(
      () => js<string>('return window.__stage3.output'),
      (value) => value.includes('END_BURST'),
    )
    assert.equal((await js<string>('return window.__stage3.output')).split('B').length - 1, 262145)
    await call('session.resize', { id, cols: 120, rows: 40 })
    await wait(
      async () => sizes,
      (values) => values.includes(120),
    )
    await call('session.complete', {
      id,
      requestId: 'stage3-completion',
      generatorId: 'git-branches',
      params: {},
      cwd: "/tmp/stage3 a'b",
    })
    await wait(
      () => js<Array<{ type: string; payload?: { request_id?: string } }>>('return window.__stage3.messages'),
      (values) =>
        values.some((v) => v.type === 'complete_response' && v.payload?.request_id === 'stage3-completion'),
    )
    assert.ok(commands.some((c) => c.startsWith("cd -- '/tmp/stage3 a'\\''b'")))
    step('binary-completion-passed')
    const detail = await call<{ session_id: string }>('serverDetail.create', { profileId: direct })
    const info = await call<{ hostname: string }>('serverDetail.getInfo', { sessionId: detail.session_id }),
      metrics = await call<{ cpu: number }>('serverDetail.getMetrics', { sessionId: detail.session_id })
    assert.equal(info.hostname, 'stage3-synthetic')
    assert.equal(metrics.cpu, 20)
    const files = await call<{ entries: Array<{ name: string }> }>('serverDetail.listFiles', {
      sessionId: detail.session_id,
      path: '/tmp/stage3',
      showHidden: false,
    })
    assert.equal(files.entries[0].name, "中文 ' space.txt")
    await call('session.complete', {
      id,
      requestId: 'paths',
      generatorId: 'paths',
      params: { directory: '/tmp/stage3' },
      cwd: '/',
    })
    await wait(
      () =>
        js<Array<{ type: string; payload?: { request_id?: string; candidates?: unknown[] } }>>(
          'return window.__stage3.messages',
        ),
      (values) => values.some((v) => v.payload?.request_id === 'paths' && v.payload.candidates?.length === 2),
    )
    step('details-path-completion-passed')
    await call('history.record', { profileId: direct, command: 'echo 合成历史', cwd: '/tmp' })
    assert.equal((await call<unknown[]>('history.list', { profileId: direct })).length, 1)
    await call('localState.write', {
      key: 'history_settings',
      value: { enabled: false, maxEntries: 500, retentionDays: 30 },
    })
    await call('history.record', { profileId: direct, command: '隐私命令', cwd: '/' })
    assert.equal((await call<unknown[]>('history.list', { profileId: direct })).length, 1)
    await call('localState.write', {
      key: 'history_settings',
      value: { enabled: true, maxEntries: 500, retentionDays: 30 },
    })
    const key = await call<{ private_key: string }>('vault.generateKeyPair', {
      request: { algo: 'ed25519', passphrase: '阶段三私钥密语' },
    })
    for (const request of [
      { auth_type: 'key', password: undefined, private_key: key.private_key, passphrase: '阶段三私钥密语' },
      { password: 'wrong-password' },
      { proxy: { type: 'http', host: '127.0.0.1', port: proxyPort } },
      { proxy: { type: 'socks5', host: '127.0.0.1', port: socksPort } },
      { proxy: { type: 'jump', jump_profile_id: direct } },
    ]) {
      step('route-' + String(request.auth_type ?? request.proxy?.type ?? 'keyboard-interactive'))
      const profileId = await newProfile(request)
      const session = await open(profileId)
      await call('session.close', { id: session })
    }
    const tunnelProfile = await newProfile({ username: 'synthetic-tunnel' })
    for (const kind of ['local', 'dynamic', 'remote'] as const) {
      step('tunnel-' + kind)
      const config = await call<{ id: string }>('tunnel.save', {
        config: {
          id: '',
          name: '阶段三 ' + kind,
          profile_id: tunnelProfile,
          kind,
          bind_host: '127.0.0.1',
          bind_port: 0,
          target_host: '127.0.0.1',
          target_port: echoPort,
        },
      })
      tunnelIds.push(config.id)
      await call('tunnel.start', { id: config.id })
      const states = await wait(
          () => call<Array<{ id: string; status: string; bound_port: number }>>('tunnel.statuses'),
          (rows) => rows.some((r) => r.id === config.id && r.status === 'running'),
        ),
        bound = states.find((r) => r.id === config.id)!.bound_port
      const socket = tracked(net.connect(bound, '127.0.0.1'))
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve)
        socket.once('error', reject)
      })
      if (kind === 'dynamic') {
        await proxyHandshake(socket, 'socks5', 'localhost', echoPort)
        socket.resume()
      }
      const echoed = new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Tunnel echo timeout')), 5000)
        socket.once('data', (b) => {
          clearTimeout(t)
          resolve(b.toString())
        })
      })
      socket.write('tunnel-' + kind)
      assert.equal(await echoed, 'tunnel-' + kind)
      socket.end()
      if (kind === 'local') {
        for (const client of clients) if (usernames.get(client) === 'synthetic-tunnel') client.end()
        await wait(
          () => call<Array<{ id: string; status: string; retry_attempt: number }>>('tunnel.statuses'),
          (rows) => rows.some((r) => r.id === config.id && r.status === 'running' && r.retry_attempt > 0),
        )
      }
      await call('tunnel.stop', { id: config.id })
      assert.equal(
        await new Promise<boolean>((resolve) => {
          const probe = net.connect(bound, '127.0.0.1')
          probe.on('connect', () => {
            probe.destroy()
            resolve(false)
          })
          probe.on('error', () => resolve(true))
        }),
        true,
      )
    }
    step('fault-injection')
    const mfa = await call<{ session_id: string }>('session.create', {
      request: { profile_id: await newProfile({ password: 'wrong-password' }) },
    })
    sessionIds.push(mfa.session_id)
    const mfaMessages = await wait(
      () =>
        call<Array<{ type: string; payload: { request_id?: string } }>>('session.attach', {
          id: mfa.session_id,
        }),
      (rows) => rows.some((m) => m.type === 'auth_request'),
    )
    const authId = mfaMessages.find((m) => m.type === 'auth_request')!.payload.request_id
    await call('session.close', { id: mfa.session_id })
    await assert.rejects(call('session.authRespond', { requestId: authId, responses: ['123456'] }), /失效/)
    step('mfa-cancel-passed')
    let prematureAuth = 0
    const unknownServer = new Server({ hostKeys: [host.private] }, (client) => {
      clients.add(client)
      client.on('error', () => undefined)
      client.once('close', () => clients.delete(client))
      client.on('authentication', (ctx) => {
        prematureAuth++
        ctx.reject()
      })
    })
    const unknownPort = await listen(unknownServer),
      unknownProfile = await newProfile({ port: unknownPort })
    try {
      for (const decision of ['reject', 'cancel']) {
        const created = await call<{ session_id: string }>('session.create', {
          request: { profile_id: unknownProfile },
        })
        sessionIds.push(created.session_id)
        const messages = await wait(
          () =>
            call<
              Array<{
                type: string
                payload: {
                  waiting_for_host_key?: boolean
                  host_key_request_id?: string
                  host_key_fingerprint?: string
                }
              }>
            >('session.attach', { id: created.session_id }),
          (rows) => rows.some((m) => m.payload?.waiting_for_host_key),
        )
        const prompt = messages.find((m) => m.payload?.waiting_for_host_key)!.payload
        if (decision === 'reject') {
          await call('session.decide', {
            requestId: prompt.host_key_request_id,
            fingerprint: prompt.host_key_fingerprint,
            decision: 'reject',
          })
          await wait(
            () => call<Array<{ id: string; status: string }>>('session.list'),
            (rows) => rows.some((r) => r.id === created.session_id && r.status === 'error'),
          )
        }
        await call('session.close', { id: created.session_id })
        await assert.rejects(
          call('session.decide', {
            requestId: prompt.host_key_request_id,
            fingerprint: prompt.host_key_fingerprint,
            decision: 'trust_once',
          }),
          /过期/,
        )
      }
      assert.equal(prematureAuth, 0)
    } finally {
      await new Promise<void>((r) => unknownServer.close(() => r()))
    }
    step('host-reject-cancel-passed')
    const stalled = new Set<net.Socket>(),
      stall = net.createServer((socket) => {
        tracked(socket)
        socket.resume()
        stalled.add(socket)
        socket.once('close', () => stalled.delete(socket))
      })
    resources.add(stall)
    const stallPort = await listen(stall),
      stallProfile = await newProfile({ port: stallPort }),
      stalledSession = await call<{ session_id: string }>('session.create', {
        request: { profile_id: stallProfile },
      })
    sessionIds.push(stalledSession.session_id)
    await wait(
      async () => stalled.size,
      (n) => n === 1,
    )
    await call('session.close', { id: stalledSession.session_id })
    await wait(
      async () => stalled.size,
      (n) => n === 0,
    )
    step('handshake-stop-passed')
    const deniedProxy = net.createServer((socket) => {
      tracked(socket)
      socket.on('data', () => socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'))
    })
    resources.add(deniedProxy)
    const deniedPort = await listen(deniedProxy),
      denied = await call<{ session_id: string }>('session.create', {
        request: {
          profile_id: await newProfile({ proxy: { type: 'http', host: '127.0.0.1', port: deniedPort } }),
        },
      })
    sessionIds.push(denied.session_id)
    await wait(
      () => call<Array<{ id: string; status: string }>>('session.list'),
      (rows) => rows.some((r) => r.id === denied.session_id && r.status === 'error'),
    )
    await call('session.close', { id: denied.session_id })
    step('proxy-rejection-passed')
    const busy = await call<{ id: string }>('tunnel.save', {
      config: {
        id: '',
        name: '端口占用',
        profile_id: direct,
        kind: 'local',
        bind_host: '127.0.0.1',
        bind_port: echoPort,
        target_host: '127.0.0.1',
        target_port: echoPort,
      },
    })
    tunnelIds.push(busy.id)
    await call('tunnel.start', { id: busy.id })
    await wait(
      () => call<Array<{ id: string; status: string }>>('tunnel.statuses'),
      (rows) => rows.some((r) => r.id === busy.id && r.status === 'failed'),
    )
    await call('tunnel.stop', { id: busy.id })
    step('port-occupied-passed')
    const limited = await call<{ id: string }>('tunnel.save', {
      config: {
        id: '',
        name: '半包及并发',
        profile_id: direct,
        kind: 'dynamic',
        bind_host: '127.0.0.1',
        bind_port: 0,
        target_host: 'localhost',
        target_port: echoPort,
      },
    })
    tunnelIds.push(limited.id)
    await call('tunnel.start', { id: limited.id })
    const limitedStates = await wait(
        () => call<Array<{ id: string; status: string; bound_port: number }>>('tunnel.statuses'),
        (rows) => rows.some((r) => r.id === limited.id && r.status === 'running'),
      ),
      limitedPort = limitedStates.find((r) => r.id === limited.id)!.bound_port
    const waiting: net.Socket[] = []
    for (let i = 0; i < 32; i++) {
      const peer = tracked(net.connect(limitedPort, '127.0.0.1'))
      await new Promise<void>((resolve, reject) => {
        peer.once('connect', resolve)
        peer.once('error', reject)
      })
      peer.write(Buffer.from([5]))
      peer.resume()
      waiting.push(peer)
    }
    await wait(
      () => call<Array<{ id: string; active_connections: number }>>('tunnel.statuses'),
      (rows) => rows.some((r) => r.id === limited.id && r.active_connections === 32),
    )
    const overflow = tracked(net.connect(limitedPort, '127.0.0.1'))
    overflow.resume()
    await new Promise<void>((resolve) => overflow.once('close', () => resolve()))
    await call('tunnel.stop', { id: limited.id })
    await wait(
      async () => waiting.every((s) => s.destroyed),
      (v) => v,
    )
    const beforeInput = inputs.length
    await call('session.reconnect', { id })
    await wait(
      () => call<Array<{ id: string; status: string }>>('session.list'),
      (rows) => rows.some((r) => r.id === id && r.status === 'connected'),
    )
    assert.equal(inputs.length, beforeInput)
    await call('serverDetail.close', { sessionId: detail.session_id })
    await call('session.close', { id })
    assert.equal((await call<unknown[]>('session.list')).length, 0)
    return {
      passed: true,
      authentication: ['password', 'encrypted-private-key', 'keyboard-interactive'],
      routes: ['direct', 'http-connect', 'socks5', 'jump'],
      binary: { utf8: true, consumedBytes: 262144, replayedInput: false },
      hostKey: { wrongRejected: true, staleRejected: true, permanent: true },
      completion: true,
      historyPrivacy: true,
      details: true,
      tunnels: ['local', 'remote', 'dynamic'],
      portsReleased: true,
      tunnelReconnect: true,
      faults: {
        hostRejectBeforeAuthentication: true,
        hostCancel: true,
        mfaCancel: true,
        handshakeStop: true,
        proxyRejected: true,
        portOccupied: true,
        halfPacketStop: true,
        tunnelLimit32: true,
      },
      agent: '待目标平台 Agent 实测',
    }
  } catch (error) {
    console.error('EIZHU_STAGE3_FAILED', error)
    throw error
  } finally {
    step('cleanup')
    for (const id of sessionIds) await call('session.close', { id }).catch(() => undefined)
    for (const id of tunnelIds) await call('tunnel.delete', { id }).catch(() => undefined)
    for (const id of profileIds.reverse()) {
      await call('history.delete', { profileId: id }).catch(() => undefined)
      await call('profile.delete', { id }).catch(() => undefined)
    }
    for (const stream of shells) stream.destroy()
    for (const client of clients) {
      client.end()
      ;(client as unknown as { _sock: net.Socket })._sock.destroy()
    }
    for (const socket of sockets) socket.destroy()
    for (const server of resources) await new Promise<void>((r) => server.close(() => r()))
    await new Promise<void>((r) => sshServer.close(() => r()))
  }
}
