/* eslint-disable no-control-regex -- Remote OSC sequences contain literal terminal control bytes. */
import { randomUUID,createHash } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { posix } from 'node:path'
import type { ClientChannel } from 'ssh2'
import { ssh, fail, failureOf, DesktopError } from '@eizhu/contracts'
import type { RuntimeContext } from '@eizhu/contracts'
import type { Session, SessionCreateRequest } from '@eizhu/contracts/models/session'
import type { SessionMessage, ConnectionLogEntry } from '@eizhu/contracts/models/sessionMessage'
import type { TunnelConfig, TunnelStatus } from '@eizhu/contracts/models/api'
import type { WorkerClient } from '../workers/client.ts'
import { SshConnection, execBounded } from './connection.ts'
import type { HandshakeHooks } from './connection.ts'
import type { ConnectionHop } from './plan.ts'
import { TerminalStream } from './stream.ts'
import type { BinaryPort } from './stream.ts'
import { complete, readDirectory } from './completion.ts'
import { INFO_COMMAND, METRICS_COMMAND, parseInfo, parseMetrics } from './metrics.ts'
import { TunnelListener } from './tunnel.ts'
interface TerminalSession {
  meta: Session
  cols: number
  rows: number
  connection: SshConnection
  stream: TerminalStream
  shell?: ClientChannel
  task?: Promise<void>
  closing?: Promise<void>
  closed: boolean
  retry: number
  timer?: NodeJS.Timeout
  logs: ConnectionLogEntry[]
  stage: string
  queries: number
  pending: Map<string, SessionMessage>
  reconnecting?: Promise<{ session_id: string; status: string }>
  cache: Map<string, { at: number; value: Awaited<ReturnType<typeof complete>> }>
  state?: SessionMessage
  metadata?: SessionMessage
  cwd?: string
}
interface Prompt {
  owner: string
  connection: SshConnection
  fingerprint?: string
  endpoint?: string
  resolve: (value: string[]) => void
  timer: NodeJS.Timeout
  count: number
}
interface Tunnel {
  config: TunnelConfig
  state: TunnelStatus
  connection: SshConnection
  listener?: TunnelListener
  task?: Promise<void>
  closing?: Promise<void>
  closed: boolean
  timer?: NodeJS.Timeout
}
type Emit = (name: 'eizhu-session-message', payload: unknown) => void
export class SshService {
  private compute: WorkerClient
  private database: WorkerClient
  private context: RuntimeContext
  private emit: Emit
  private terminals = new Map<string, TerminalSession>()
  private details = new Map<string, string>()
  private prompts = new Map<string, Prompt>()
  private tunnels = new Map<string, Tunnel>()
  private subscriptions = new Map<string, { id: string; port: BinaryPort }>()
  private closing?: Promise<void>
  private closed = false
  private transitions = new Map<string, Promise<unknown>>()
  private fileOwners = new Map<string, (type:string,payload:unknown)=>void>()
  async connectFiles(owner:string,profileId:string,connection:SshConnection,notify:(type:string,payload:unknown)=>void,disconnected:()=>void){
    this.fileOwners.set(owner,notify)
    const plan=await this.plan({id:profileId}),hooks=this.hooks(owner,connection,disconnected),verify=hooks.verify,fingerprints:string[]=[]
    hooks.verify=async(hop,fingerprint)=>{const accepted=await verify(hop,fingerprint);if(accepted)fingerprints.push(fingerprint);return accepted}
    const client=await connection.connect(plan,hooks)
    const binding=createHash('sha256').update(JSON.stringify({route:plan.map(h=>[h.profile.host,h.profile.port,h.profile.username,h.proxy.type,h.proxy.host,h.proxy.port]),fingerprints})).digest('hex')
    return {client,binding}
  }
  releaseFiles(owner:string):void{this.cancelPrompts(owner);this.fileOwners.delete(owner)}
  fileClient(id:string){const s=this.connected(id);return {client:s.connection.client!,profileId:s.meta.profile_id}}
  async decideFiles(requestId:string,fingerprint:string,decision:string){return this.decide(requestId,fingerprint,decision)}
  constructor(database: WorkerClient, compute: WorkerClient, context: RuntimeContext, emit: Emit) {
    this.compute = compute
    this.database = database
    this.context = context
    this.emit = emit
  }
  private async plan(input: unknown): Promise<ConnectionHop[]> {
    const plan = await this.database.call<ConnectionHop[]>('ssh.plan', input)
    for (const hop of plan)
      if (hop.credential.private_key) {
        hop.credential.private_key = await this.compute.call<string>('ssh.decryptKey', hop.credential)
        delete hop.credential.passphrase
      }
    return plan
  }
  private global(type: string, id: string, payload: unknown): void {
    this.emit('eizhu-session-message', {
      type,
      session_id: id,
      payload,
      workspaceGeneration: this.context.generation,
    })
  }
  private event(s: TerminalSession, message: SessionMessage): void {
    if (s.closed) return
    if (message.type === 'connection_state') s.state = message
    if (message.type === 'metadata') s.metadata = message
    s.stream.event(message)
  }
  private state(
    s: TerminalSession,
    status: Session['status'],
    stage: string,
    message: string,
    extra: Record<string, unknown> = {},
  ): void {
    s.meta.status = status
    s.stage = stage
    s.logs.push({ at: Date.now(), level: status === 'error' ? 'error' : 'info', stage, message })
    s.logs = s.logs.slice(-60)
    this.event(s, {
      type: 'connection_state',
      payload: { session_id: s.meta.id, status, stage, message, logs: s.logs, ...extra },
    })
  }
  private cancelPrompts(owner: string): void {
    for (const [id, p] of this.prompts)
      if (p.owner === owner) {
        clearTimeout(p.timer)
        this.prompts.delete(id)
        p.resolve([])
        this.promptClosed(owner, id)
      }
  }
  private promptClosed(owner: string, id: string): void {
    if(this.fileOwners.has(owner)){this.fileOwners.get(owner)!('auth_closed',{request_id:id});return}
    const s = this.terminals.get(owner)
    if (s) {
      s.pending.delete(id)
      this.event(s, { type: 'auth_request_closed', payload: { request_id: id } })
    } else this.global('tunnel_auth_closed', owner, { request_id: id })
  }
  private async prompt(
    owner: string,
    connection: SshConnection,
    hop: ConnectionHop,
    name: string,
    instructions: string,
    prompts: Array<{ prompt: string; echo: boolean }>,
    fingerprint?: string,
    known?: string,
  ): Promise<string[]> {
    if (this.prompts.size >= 64) fail('QUEUE_FULL', '等待认证的连接过多')
    const id = randomUUID(),
      endpoint = JSON.stringify([hop.profile.host, hop.profile.port])
    const promise = new Promise<string[]>((resolve) => {
      const timer = setTimeout(() => {
        this.prompts.delete(id)
        this.promptClosed(owner, id)
        resolve([])
      }, 120000)
      this.prompts.set(id, {
        owner,
        connection,
        resolve,
        timer,
        count: prompts.length,
        fingerprint,
        endpoint,
      })
    })
    const s = this.terminals.get(owner)
    const payload = {
      request_id: id,
      profile_id: hop.profile.id,
      name: name.slice(0, 4096),
      instructions: instructions.slice(0, 8192),
      prompts: prompts.map((p) => ({ prompt: p.prompt.slice(0, 4096), echo: p.echo })),
      ...(fingerprint ? { fingerprint, known_fingerprint: known ?? '' } : {}),
    }
    if (s) {
      if (fingerprint)
        this.state(s, s.meta.status, 'hostkey_confirm', '请确认主机指纹', {
          waiting_for_host_key: true,
          host_key_request_id: id,
          host_key_fingerprint: fingerprint,
          known_host_key_fingerprint: known,
        })
      else {
        const message: SessionMessage = { type: 'auth_request', payload }
        s.pending.set(id, message)
        this.event(s, message)
      }
    } else if(this.fileOwners.has(owner))this.fileOwners.get(owner)!(fingerprint?'host_key':'auth_request',payload)
    else this.global(fingerprint ? 'tunnel_host_key_request' : 'tunnel_auth_request', owner, payload)
    const abort = () => {
      const p = this.prompts.get(id)
      if (p) {
        clearTimeout(p.timer)
        this.prompts.delete(id)
        p.resolve([])
        this.promptClosed(owner, id)
      }
    }
    connection.controller.signal.addEventListener('abort', abort, { once: true })
    if (connection.controller.signal.aborted) abort()
    try {
      return await promise
    } finally {
      connection.controller.signal.removeEventListener('abort', abort)
    }
  }
  private hooks(
    owner: string,
    connection: SshConnection,
    disconnected: () => void,
    test = false,
  ): HandshakeHooks {
    return {
      verify: async (hop, fingerprint) => {
        const endpoint = JSON.stringify([hop.profile.host, hop.profile.port]),
          known = await this.database.call<string | null>('ssh.known', { endpoint })
        if (connection.controller.signal.aborted) return false
        if (known === fingerprint) return true
        if (test) fail('HOST_KEY_CONFIRM_REQUIRED', '测试连接需要先通过终端确认主机指纹')
        const answer = await this.prompt(
          owner,
          connection,
          hop,
          hop.profile.name,
          '请核对 SSH 主机指纹',
          [],
          fingerprint,
          known ?? undefined,
        )
        return answer[0] === 'trust_once' || answer[0] === 'trust_permanently'
      },
      authenticate: (hop, name, instructions, prompts) =>
        this.prompt(owner, connection, hop, name, instructions, prompts),
      stage: (stage, message) => {
        this.fileOwners.get(owner)?.('stage',{stage,message})
        const s = this.terminals.get(owner)
        if (s) this.state(s, s.meta.status, stage, message)
      },
      disconnected,
    }
  }
  private get(id: string): TerminalSession {
    return this.terminals.get(id) ?? fail('NOT_FOUND', 'SSH 会话不存在或已关闭')
  }
  private connected(id: string): TerminalSession {
    const s = this.get(this.details.get(id) ?? id)
    if (s.meta.status !== 'connected' || !s.connection.client) fail('SSH_NOT_CONNECTED', 'SSH 会话尚未连接')
    return s
  }
  private launch(s: TerminalSession): void {
    s.task = this.connectTerminal(s).catch(async (cause) => {
      if (s.closed) return
      const error = failureOf(cause)
      this.state(s, 'error', error.stage ?? s.stage, error.message, {
        error: error.message,
        error_code: error.code,
      })
      this.event(s, { type: 'error', payload: { code: error.code, message: error.message } })
      this.cancelPrompts(s.meta.id)
      await s.connection.close()
    })
  }
  private async connectTerminal(s: TerminalSession): Promise<void> {
    const connection = s.connection,
      owner = s.meta.id
    const plan = await this.plan({ id: s.meta.profile_id })
    const client = await connection.connect(
      plan,
      this.hooks(owner, connection, () => {
        if (
          s.closed ||
          s.connection !== connection ||
          connection.controller.signal.aborted ||
          s.meta.status !== 'connected'
        )
          return
        s.shell = undefined
        this.state(s, 'disconnected', 'disconnected', 'SSH 连接已中断')
        this.event(s, { type: 'disconnect', payload: { reason: 'network_error', message: 'SSH 连接已中断' } })
        this.cancelPrompts(owner)
        void connection.close().catch(() => undefined)
        if (s.retry < 10) {
          s.retry++
          const delay = Math.min(30000, 1000 * 2 ** (s.retry - 1))
          this.state(s, 'reconnecting', 'retry_wait', '等待重新连接', {
            retry_attempt: s.retry,
            next_retry_at: Date.now() + delay,
          })
          s.timer = setTimeout(() => {
            s.timer = undefined
            void this.reconnect(owner).catch(() => undefined)
          }, delay)
        }
      }),
    )
    if (s.closed || connection.controller.signal.aborted) return
    this.state(s, 'connecting', 'starting_shell', '服务器已通过认证，正在请求交互式终端')
    const shell = await new Promise<ClientChannel>((resolve, reject) =>
      client.shell({ term: 'xterm-256color', cols: s.cols, rows: s.rows }, (e, c) =>
        e
          ? reject(
              new DesktopError({
                code: 'SSH_SHELL_FAILED',
                message: '服务器已通过认证，但未能打开交互式终端',
              }),
            )
          : resolve(c),
      ),
    )
    if (s.closed || connection.controller.signal.aborted) {
      shell.destroy()
      return
    }
    s.shell = shell
    this.state(s, 'connected', 'ready', 'SSH 连接成功')
    const hop = plan[plan.length - 1]
    this.event(s, {
      type: 'metadata',
      payload: { session_id: owner, host: hop.profile.host, username: hop.profile.username, protocol: 'ssh' },
    })
    const decoder = new StringDecoder('utf8')
    let tail = ''
    shell.on('data', (data: Buffer) => {
      s.stream.output(data)
      tail = (tail + decoder.write(data)).slice(-8192)
      const matches = [...tail.matchAll(/\x1b\]7;file:\/\/[^/\x07\x1b]*([^\x07\x1b]*)(?:\x07|\x1b\\)/g)]
      if (matches.length) {
        const m = matches[matches.length - 1]
        try {
          const path = decodeURIComponent(m[1])
          if (path.startsWith('/') && path.length <= 32768 && !/[\x00-\x1f]/.test(path)) {
            s.cwd = path
            this.event(s, { type: 'cwd', payload: { path } })
          }
        } catch {
          /* Malformed remote OSC is ignored. */
        }
        tail = tail.slice(m.index! + m[0].length)
      }
    })
    shell.stderr.on('data', (data: Buffer) => s.stream.output(data))
    let exitCode = 0
    shell.on('exit', (code: number) => {
      exitCode = code ?? 0
    })
    shell.once('error', () => undefined)
    shell.once('close', () => {
      if (s.closed || s.connection !== connection || s.meta.status !== 'connected') return
      s.shell = undefined
      this.state(s, 'disconnected', 'shell_closed', '远端终端已关闭')
      this.event(s, { type: 'exit', payload: { code: exitCode } })
      void connection.close().catch(() => undefined)
    })
  }
  private reconnect(id: string): Promise<{ session_id: string; status: string }> {
    const s = this.get(id)
    s.reconnecting ??= this.doReconnect(id).finally(() => {
      s.reconnecting = undefined
    })
    return s.reconnecting
  }
  private async doReconnect(id: string) {
    const s = this.get(id)
    if (s.timer) clearTimeout(s.timer)
    s.timer = undefined
    if (s.closed) fail('NOT_FOUND', '会话已关闭')
    this.cancelPrompts(id)
    await s.connection.close()
    await s.task
    if (s.closed) fail('CANCELLED', '会话已关闭')
    s.connection = new SshConnection()
    s.shell = undefined
    s.metadata = undefined
    s.cwd = undefined
    s.cache.clear()
    s.logs = []
    this.state(s, 'connecting', 'preparing', '正在重新读取服务器配置与认证方式')
    this.launch(s)
    return { session_id: id, status: 'connecting' }
  }
  private closeSession(id: string): Promise<void> {
    const s = this.terminals.get(id)
    if (!s) return Promise.resolve()
    if (s.closing) return s.closing
    s.closed = true
    s.closing = (async () => {
      if (s.timer) clearTimeout(s.timer)
      this.cancelPrompts(id)
      s.stream.close()
      s.shell?.destroy()
      try {
        await s.connection.close()
        await s.task
      } finally {
        this.terminals.delete(id)
        for (const [key, value] of this.details) if (value === id) this.details.delete(key)
        for (const [key, value] of this.subscriptions)
          if (value.id === id) {
            value.port.close()
            this.subscriptions.delete(key)
          }
      }
    })()
    return s.closing
  }
  async bind(id: string, subscriptionId: string, port: BinaryPort): Promise<void> {
    if (this.closed) fail('RUNTIME_CLOSED', '业务进程已关闭')
    const s = this.get(id)
    for (const [key, value] of this.subscriptions)
      if (value.id === id) {
        value.port.close()
        this.subscriptions.delete(key)
      }
    this.subscriptions.set(subscriptionId, { id, port })
    s.stream.bind(port)
    if (s.state) port.postMessage({ type: 'event', message: s.state })
    if (s.meta.status === 'connected' && s.metadata) port.postMessage({ type: 'event', message: s.metadata })
    for (const message of s.pending.values()) port.postMessage({ type: 'event', message })
  }
  private async decide(requestId: string, fingerprint: string, decision: string) {
    const p = this.prompts.get(requestId)
    if (!p?.fingerprint || p.fingerprint !== fingerprint || p.connection.controller.signal.aborted)
      fail('STALE_CONFIRMATION', '指纹确认已过期，请核对当前提示')
    this.prompts.delete(requestId)
    clearTimeout(p.timer)
    try {
      if (decision === 'trust_permanently')
        await this.database.call('ssh.trust', { endpoint: p.endpoint, fingerprint })
      if (p.connection.controller.signal.aborted) fail('STALE_CONFIRMATION', '连接已取消')
      p.resolve([decision])
      this.promptClosed(p.owner, requestId)
      return {
        status: decision === 'reject' ? 'disconnected' : 'connecting',
        persisted: decision === 'trust_permanently',
      }
    } catch (error) {
      p.resolve([])
      throw error
    }
  }
  async execute(operation: keyof typeof ssh, raw: unknown): Promise<unknown> {
    if (['tunnel.start', 'tunnel.stop', 'tunnel.delete', 'tunnel.save'].includes(operation)) {
      const input = ssh[operation].input.parse(raw) as { id?: string; config?: TunnelConfig },
        id = input.id ?? input.config?.id ?? ''
      const previous = this.transitions.get(id) ?? Promise.resolve()
      const task = previous.catch(() => undefined).then(() => this.executeUnlocked(operation, input))
      this.transitions.set(id, task)
      try {
        return await task
      } finally {
        if (this.transitions.get(id) === task) this.transitions.delete(id)
      }
    }
    return this.executeUnlocked(operation, raw)
  }
  private async executeUnlocked(operation: keyof typeof ssh, raw: unknown): Promise<unknown> {
    if (this.closed) fail('RUNTIME_CLOSED', '业务进程已关闭')
    const input = ssh[operation].input.parse(raw)
    switch (operation) {
      case 'session.create': {
        if (this.terminals.size >= 128) fail('QUEUE_FULL', 'SSH 会话过多')
        const { request } = input as { request: SessionCreateRequest }
        await this.database.call('profile.get', { id: request.profile_id })
        const id = randomUUID(),
          connection = new SshConnection()
        const s: TerminalSession = {
          meta: {
            id,
            profile_id: request.profile_id,
            status: 'connecting',
            created_at: new Date().toISOString(),
          },
          cols: request.cols ?? 80,
          rows: request.rows ?? 24,
          connection,
          closed: false,
          retry: 0,
          logs: [],
          stage: 'preparing',
          queries: 0,
          pending: new Map(),
          cache: new Map(),
          stream: new TerminalStream((paused) => {
            if (paused) s.shell?.pause()
            else s.shell?.resume()
          }),
        }
        this.terminals.set(id, s)
        this.state(s, 'connecting', 'preparing', '正在读取服务器配置与认证方式')
        this.launch(s)
        return { session_id: id, status: 'connecting' }
      }
      case 'session.list':
        return [...this.terminals.values()].filter((s) => !s.closed).map((s) => s.meta)
      case 'session.attach': {
        const s = this.get((input as { id: string }).id)
        return [...(s.state ? [s.state] : []), ...(s.metadata ? [s.metadata] : []), ...s.pending.values()]
      }
      case 'session.close':
        return this.closeSession((input as { id: string }).id)
      case 'session.reconnect':
        return this.reconnect((input as { id: string }).id)
      case 'session.input': {
        const d = input as { id: string; data: string },
          s = this.connected(d.id)
        if (!s.shell) fail('SSH_NOT_CONNECTED', '终端未就绪')
        if (s.shell.writableLength > 65536) fail('QUEUE_FULL', '终端输入过快，请稍后重试')
        s.shell.write(d.data)
        return
      }
      case 'session.resize': {
        const d = input as { id: string; cols: number; rows: number },
          s = this.get(d.id)
        s.cols = d.cols
        s.rows = d.rows
        s.shell?.setWindow(d.rows, d.cols, 0, 0)
        return
      }
      case 'session.ping': {
        const s = this.connected((input as { id: string }).id),
          connection = s.connection
        if (s.queries >= 4) fail('QUEUE_FULL', '远端查询繁忙')
        s.queries++
        try {
          await execBounded(connection.client!, 'true', connection.controller.signal, 1024)
          if (s.connection === connection) this.event(s, { type: 'pong' })
        } finally {
          s.queries--
        }
        return
      }
      case 'session.confirmHostKey':
        return fail('STALE_CONFIRMATION', '请使用当前指纹提示作出信任决定')
      case 'session.decide': {
        const d = ssh[operation].input.parse(input)
        return this.decide(d.requestId, d.fingerprint, d.decision)
      }
      case 'session.authRespond': {
        const d = ssh[operation].input.parse(input),
          p = this.prompts.get(d.requestId)
        if (!p || p.connection.controller.signal.aborted) fail('STALE_CONFIRMATION', '认证请求已失效')
        if (p.fingerprint) {
          if (!['trust_once', 'trust_permanently', 'reject'].includes(d.responses[0]))
            fail('BAD_REQUEST', '信任决定无效')
          await this.decide(d.requestId, d.responses[1], d.responses[0])
          return
        }
        if (d.responses.length !== p.count) fail('BAD_REQUEST', '认证回答数量不匹配')
        this.prompts.delete(d.requestId)
        clearTimeout(p.timer)
        p.resolve(d.responses)
        this.promptClosed(p.owner, d.requestId)
        return
      }
      case 'session.unsubscribe': {
        const d = ssh[operation].input.parse(input),
          p = this.subscriptions.get(d.subscriptionId)
        if (p && p.id !== d.id) fail('FORBIDDEN', '订阅不属于当前会话')
        p?.port.close()
        this.subscriptions.delete(d.subscriptionId)
        return
      }
      case 'session.complete': {
        const d = ssh[operation].input.parse(input),
          s = this.connected(d.id)
        if (s.queries >= 2) fail('QUEUE_FULL', '远端查询繁忙')
        const connection = s.connection,
          key = JSON.stringify([d.generatorId, d.params, d.cwd ?? s.cwd ?? '~'])
        s.queries++
        try {
          let cached = s.cache.get(key)
          if (!cached || Date.now() - cached.at > 3000) {
            cached = {
              at: Date.now(),
              value: await complete(
                connection.client!,
                d,
                d.cwd ?? s.cwd ?? '~',
                connection.controller.signal,
              ),
            }
            if (s.cache.size >= 32) s.cache.delete(s.cache.keys().next().value!)
            s.cache.set(key, cached)
          }
          if (s.connection === connection && !s.closed)
            this.event(s, {
              type: 'complete_response',
              payload: {
                request_id: d.requestId,
                output: cached.value.output,
                candidates: cached.value.candidates,
                exit_code: cached.value.code,
                error: '',
              },
            })
        } catch {
          if (s.connection === connection && !s.closed)
            this.event(s, {
              type: 'complete_response',
              payload: { request_id: d.requestId, output: '', error: '补全查询失败', exit_code: 1 },
            })
        } finally {
          s.queries--
        }
        return
      }
      case 'history.list':
      case 'history.record':
      case 'history.delete':
        return this.database.call(operation, input)
      case 'profile.testNew':
      case 'profile.testExisting': {
        const d = input as { id?: string; request: unknown },
          connection = new SshConnection(),
          started = Date.now()
        let stage = 'resolve',
          fingerprint: string | undefined,
          known: string | null = null
        try {
          const plan = await this.plan(d),
            hooks = this.hooks(randomUUID(), connection, () => undefined, true)
          hooks.stage = (value) => {
            stage = value
          }
          hooks.verify = async (hop, fp) => {
            fingerprint = fp
            known = await this.database.call('ssh.known', {
              endpoint: JSON.stringify([hop.profile.host, hop.profile.port]),
            })
            return known === fp
          }
          hooks.authenticate = async () => []
          await connection.connect(plan, hooks)
          return {
            success: true,
            message: 'SSH 认证成功',
            latency_ms: Date.now() - started,
            stages: [{ stage: 'ssh_auth', status: 'success', message: 'SSH 认证成功' }],
          }
        } catch {
          const untrusted = Boolean(fingerprint && fingerprint !== known)
          return {
            success: false,
            message: untrusted ? '请先连接并确认主机指纹' : '连接失败，请检查路由与认证',
            latency_ms: Date.now() - started,
            stages: [
              {
                stage: untrusted ? 'host_key' : stage,
                status: untrusted ? 'warning' : 'error',
                message: untrusted ? '尚未信任此主机指纹' : '连接或认证失败',
                fingerprint,
                known_fingerprint: known ?? undefined,
              },
            ],
          }
        } finally {
          await connection.close()
        }
      }
      case 'serverDetail.create': {
        const { profileId } = ssh[operation].input.parse(input)
        const s = [...this.terminals.values()].find(
          (s) => s.meta.profile_id === profileId && s.meta.status === 'connected',
        )
        if (!s) fail('SSH_NOT_CONNECTED', '请先连接终端')
        if (this.details.size >= 128) fail('QUEUE_FULL', '详情会话过多')
        const id = randomUUID()
        this.details.set(id, s.meta.id)
        return { session_id: id, status: 'connected', home_dir: s.cwd ?? '/' }
      }
      case 'serverDetail.close':
        this.details.delete((input as { sessionId: string }).sessionId)
        return
      case 'serverDetail.getInfo':
      case 'serverDetail.getMetrics':
      case 'serverDetail.listFiles': {
        const d = input as { sessionId: string; path?: string; showHidden?: boolean },
          s = this.connected(d.sessionId)
        if (s.queries >= 4) fail('QUEUE_FULL', '远端查询繁忙')
        s.queries++
        try {
          if (operation === 'serverDetail.listFiles') {
            const path = posix.normalize(d.path!),
              rows = await readDirectory(s.connection.client!, path, s.connection.controller.signal)
            return {
              path,
              entries: rows
                .filter(
                  (r) =>
                    r.filename !== '.' &&
                    r.filename !== '..' &&
                    (d.showHidden || !r.filename.startsWith('.')),
                )
                .map((r) => ({
                  name: r.filename,
                  path: posix.join(path, r.filename),
                  is_dir: r.attrs.isDirectory(),
                  size: r.attrs.size,
                  mod_time: new Date(r.attrs.mtime * 1000).toISOString(),
                  mode: r.attrs.mode.toString(8),
                })),
            }
          }
          const result = await execBounded(
            s.connection.client!,
            operation === 'serverDetail.getInfo' ? INFO_COMMAND : METRICS_COMMAND,
            s.connection.controller.signal,
          )
          if (result.code !== 0) fail('SSH_EXEC_FAILED', '服务器查询失败')
          return operation === 'serverDetail.getInfo' ? parseInfo(result.output) : parseMetrics(result.output)
        } finally {
          s.queries--
        }
      }
      case 'tunnel.list':
        return this.database.call(operation)
      case 'tunnel.statuses': {
        const configs = await this.database.call<TunnelConfig[]>('tunnel.list')
        return configs.map((c) => this.tunnels.get(c.id)?.state ?? this.tunnelState(c.id))
      }
      case 'tunnel.save': {
        const { config } = ssh[operation].input.parse(input)
        if (this.tunnels.has(config.id)) await this.stopTunnel(config.id)
        return this.database.call(operation, input)
      }
      case 'tunnel.delete': {
        const { id } = ssh[operation].input.parse(input)
        await this.stopTunnel(id)
        const result = await this.database.call(operation, input)
        this.tunnels.delete(id)
        return result
      }
      case 'tunnel.start':
        return this.startTunnel((input as { id: string }).id)
      case 'tunnel.stop':
        return this.stopTunnel((input as { id: string }).id)
      default:
        return fail('FORBIDDEN', '终端订阅必须经授权的二进制通道建立')
    }
  }
  private tunnelState(id: string): TunnelStatus {
    return {
      id,
      status: 'stopped',
      generation: this.context.generation,
      revision: 0,
      bound_port: null,
      active_connections: 0,
      retry_attempt: 0,
      error_code: null,
      error_message: null,
    }
  }
  private tunnelUpdate(t: Tunnel, changes: Partial<TunnelStatus>): void {
    Object.assign(t.state, changes, { revision: t.state.revision + 1 })
    this.global('tunnel_status', t.config.id, t.state)
  }
  private async startTunnel(id: string) {
    const existing = this.tunnels.get(id)
    if (existing && !existing.closed && ['running', 'connecting'].includes(existing.state.status))
      return existing.state
    const configs = await this.database.call<TunnelConfig[]>('tunnel.list'),
      config = configs.find((c) => c.id === id) ?? fail('NOT_FOUND', '隧道不存在')
    if (existing) await this.stopTunnel(id)
    const t: Tunnel = {
      config,
      state: { ...this.tunnelState(id), revision: (existing?.state.revision ?? 0) + 1, status: 'connecting' },
      connection: new SshConnection(),
      closed: false,
    }
    this.tunnels.set(id, t)
    this.tunnelUpdate(t, { status: 'connecting' })
    this.launchTunnel(t)
    return t.state
  }
  private launchTunnel(t: Tunnel): void {
    t.task = this.connectTunnel(t).catch(async (error) => {
      if (t.closed) return
      const f = failureOf(error)
      this.tunnelUpdate(t, {
        status: 'failed',
        error_code: f.code,
        error_message: f.message,
        bound_port: null,
      })
      this.cancelPrompts(t.config.id)
      await Promise.all([t.listener?.close(), t.connection.close()]).catch(() => undefined)
      if (t.state.retry_attempt > 0 && f.code !== 'SSH_AUTH_FAILED') this.retryTunnel(t)
    })
  }
  private retryTunnel(t: Tunnel): void {
    if (t.closed) return
    if (t.state.retry_attempt >= 10) {
      this.tunnelUpdate(t, {
        status: 'failed',
        error_code: 'RETRY_EXHAUSTED',
        error_message: '重连次数已达上限，请手动启动',
        bound_port: null,
        active_connections: 0,
      })
      t.task = Promise.all([t.listener?.close(), t.connection.close()])
        .then(() => undefined)
        .catch(() => undefined)
      return
    }
    const attempt = t.state.retry_attempt + 1
    this.cancelPrompts(t.config.id)
    this.tunnelUpdate(t, {
      status: 'reconnecting',
      retry_attempt: attempt,
      bound_port: null,
      active_connections: 0,
    })
    const old = t.connection,
      listener = t.listener
    t.task = Promise.all([listener?.close(), old.close()])
      .catch(() => undefined)
      .then(() => {
        if (t.closed) return
        t.timer = setTimeout(
          () => {
            t.timer = undefined
            if (t.closed) return
            t.connection = new SshConnection()
            t.listener = undefined
            this.launchTunnel(t)
          },
          Math.min(30000, 1000 * 2 ** (attempt - 1)),
        )
      })
  }
  private async connectTunnel(t: Tunnel): Promise<void> {
    const plan = await this.plan({ id: t.config.profile_id })
    const client = await t.connection.connect(
      plan,
      this.hooks(t.config.id, t.connection, () => {
        if (t.closed || t.connection.controller.signal.aborted || t.state.status !== 'running') return
        this.retryTunnel(t)
      }),
    )
    if (t.closed) return
    const listener = new TunnelListener(client, t.config, (count) => {
      if (!t.closed) this.tunnelUpdate(t, { active_connections: count })
    })
    t.listener = listener
    const port = await listener.start()
    if (t.closed) {
      await listener.close()
      return
    }
    if (t.config.bind_port === 0) t.config = { ...t.config, bind_port: port }
    this.tunnelUpdate(t, { status: 'running', bound_port: port, error_code: null, error_message: null })
  }
  private stopTunnel(id: string): Promise<void> {
    const t = this.tunnels.get(id)
    if (!t) return Promise.resolve()
    if (t.closing) return t.closing
    t.closed = true
    t.closing = (async () => {
      if (t.timer) clearTimeout(t.timer)
      this.cancelPrompts(id)
      await Promise.all([t.listener?.close(), t.connection.close()])
      await t.task
      this.tunnelUpdate(t, { status: 'stopped', bound_port: null, active_connections: 0 })
    })()
    return t.closing
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = (async () => {
      await Promise.allSettled([...this.transitions.values()])
      const results = await Promise.allSettled(
        [...this.terminals.keys()]
          .map((id) => this.closeSession(id))
          .concat([...this.tunnels.keys()].map((id) => this.stopTunnel(id))),
      )
      this.details.clear()
      const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason as unknown)
      if (errors.length) throw new AggregateError(errors, 'SSH 资源释放失败')
    })()
    return this.closing
  }
}
