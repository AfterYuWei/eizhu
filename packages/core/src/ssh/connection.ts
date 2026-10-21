import { Client } from 'ssh2'
import type { ClientChannel } from 'ssh2'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { createHash } from 'node:crypto'
import { DesktopError } from '@eizhu/contracts'
import type { ConnectionHop } from './plan.ts'
import { proxyHandshake, networkError } from './network.ts'
export interface HandshakeHooks {
  verify: (hop: ConnectionHop, fingerprint: string) => Promise<boolean>
  authenticate: (
    hop: ConnectionHop,
    name: string,
    instructions: string,
    prompts: Array<{ prompt: string; echo: boolean }>,
  ) => Promise<string[]>
  stage: (stage: string, message: string) => void
  disconnected: () => void
}
export class SshConnection {
  private clients: Client[] = []
  private closedClients = new Set<Client>()
  private sockets: Duplex[] = []
  private closing?: Promise<void>
  readonly controller = new AbortController()
  client?: Client
  private ownSocket<T extends Duplex>(socket: T): T {
    this.sockets.push(socket)
    socket.on('error', () => undefined)
    return socket
  }
  async connect(plan: ConnectionHop[], hooks: HandshakeHooks): Promise<Client> {
    let previous: Client | undefined
    for (const hop of plan) {
      if (this.controller.signal.aborted) throw networkError('CANCELLED', '连接已取消')
      const p = hop.profile
      if (p.auth_type === 'agent' && process.platform !== 'win32' && !process.env.SSH_AUTH_SOCK)
        throw networkError('AGENT_UNAVAILABLE', '未找到系统 SSH Agent，请启动 Agent 或选择其他认证方式')
      hooks.stage('resolve', '正在建立 SSH 路由')
      let sock: Duplex | undefined
      if (previous) {
        hooks.stage('proxy', '正在通过跳板连接')
        sock = this.ownSocket(
          await new Promise<ClientChannel>((resolve, reject) =>
            previous!.forwardOut('127.0.0.1', 0, p.host, p.port, (e, s) =>
              e ? reject(networkError('JUMP_FAILED', '跳板转发失败')) : resolve(s),
            ),
          ),
        )
      } else if (hop.proxy.type === 'socks5' || hop.proxy.type === 'http') {
        hooks.stage('proxy', '正在连接代理')
        const proxy = hop.proxy
        const socket = this.ownSocket(
          net.connect({ host: proxy.host!, port: proxy.port!, allowHalfOpen: true }),
        )
        socket.setTimeout(hop.timeout, () => socket.destroy(networkError('PROXY_TIMEOUT', '代理连接超时')))
        await new Promise<void>((resolve, reject) => {
          socket.once('connect', resolve)
          socket.once('error', reject)
        })
        await proxyHandshake(
          socket,
          proxy.type as 'socks5' | 'http',
          p.host,
          p.port,
          proxy.username,
          p.proxy_password,
        )
        socket.setTimeout(0)
        sock = socket
      }
      const client = new Client()
      this.clients.push(client)
      client.on('error', () => undefined)
      client.on('close', () => {
        this.closedClients.add(client)
        if (!this.controller.signal.aborted) hooks.disconnected()
      })
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          client.destroy()
          reject(networkError('CANCELLED', '连接已取消'))
        }
        const timer = setTimeout(() => {
          client.destroy()
          reject(networkError('SSH_TIMEOUT', 'SSH 握手超时'))
        }, 150000)
        const cleanup = () => {
          clearTimeout(timer)
          this.controller.signal.removeEventListener('abort', abort)
        }
        this.controller.signal.addEventListener('abort', abort, { once: true })
        if (this.controller.signal.aborted) {
          cleanup()
          abort()
          return
        }
        client.once('ready', () => {
          cleanup()
          resolve()
        })
        client.once('error', (error: { level?: string }) => {
          cleanup()
          reject(
            networkError(
              error.level === 'client-authentication' ? 'SSH_AUTH_FAILED' : 'SSH_CONNECTION_FAILED',
              error.level === 'client-authentication' ? 'SSH 认证失败' : 'SSH 连接失败',
            ),
          )
        })
        client.once('close', () => {
          cleanup()
          reject(networkError())
        })
        client.on('keyboard-interactive', (name, instructions, _lang, prompts, finish) => {
          void hooks
            .authenticate(
              hop,
              name,
              instructions,
              prompts.slice(0, 16).map((p) => ({ prompt: p.prompt, echo: p.echo ?? false })),
            )
            .then(
              (answers) => {
                if (!this.controller.signal.aborted) finish(answers)
              },
              () => client.destroy(),
            )
        })
        const privateKey = hop.credential.private_key ? Buffer.from(hop.credential.private_key) : undefined
        try {
          hooks.stage('host_key', '正在校验主机密钥')
          client.connect({
            host: p.host,
            port: p.port,
            username: p.username,
            sock: sock as net.Socket | undefined,
            readyTimeout: 150000,
            keepaliveInterval: hop.keepalive,
            keepaliveCountMax: 3,
            tryKeyboard: true,
            password: hop.credential.password,
            privateKey,
            passphrase: hop.credential.passphrase,
            agent:
              p.auth_type === 'agent'
                ? process.platform === 'win32'
                  ? 'pageant'
                  : process.env.SSH_AUTH_SOCK
                : undefined,
            hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => {
              const fingerprint =
                'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
              void hooks.verify(hop, fingerprint).then(
                (accepted) => {
                  callback(accepted && !this.controller.signal.aborted)
                  if (accepted) hooks.stage('ssh_auth', '正在进行 SSH 认证')
                },
                () => callback(false),
              )
            },
          })
        } catch {
          this.closedClients.add(client)
          cleanup()
          reject(networkError('SSH_AUTH_FAILED', '认证配置或私钥无效'))
        } finally {
          privateKey?.fill(0)
        }
        sock?.resume()
      })
      previous = client
    }
    if (!previous) throw networkError()
    this.client = previous
    return previous
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.controller.abort()
    this.closing = (async () => {
      const sockets: Promise<void>[] = []
      for (const socket of this.sockets.splice(0)) {
        if (socket instanceof net.Socket && !socket.closed)
          sockets.push(new Promise<void>((resolve) => socket.once('close', () => resolve())))
        socket.destroy()
      }
      await Promise.all(
        this.clients
          .splice(0)
          .reverse()
          .map(
            (client) =>
              new Promise<void>((resolve, reject) => {
                if (this.closedClients.has(client)) {
                  resolve()
                  return
                }
                const timer = setTimeout(() => {
                  client.destroy()
                }, 1000)
                const deadline = setTimeout(
                  () => reject(networkError('SSH_CLOSE_FAILED', 'SSH 连接未能释放')),
                  3000,
                )
                client.once('close', () => {
                  clearTimeout(timer)
                  clearTimeout(deadline)
                  resolve()
                })
                client.end()
                client.destroy()
              }),
          ),
      )
      await Promise.all(sockets)
      this.client = undefined
    })()
    return this.closing
  }
}
export async function execBounded(
  client: Client,
  command: string,
  signal: AbortSignal,
  limit = 262144,
): Promise<{ output: string; code: number }> {
  if (signal.aborted) throw networkError('CANCELLED', '请求已取消')
  return new Promise((resolve, reject) => {
    let channel: ClientChannel | undefined,
      done = false,
      size = 0,
      code = 0
    const chunks: Buffer[] = []
    const finish = (error?: unknown) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      channel?.destroy()
      if (error) reject(error)
      else resolve({ output: Buffer.concat(chunks).toString('utf8'), code })
    }
    const abort = () => finish(networkError('CANCELLED', '请求已取消'))
    const timer = setTimeout(() => finish(networkError('SSH_EXEC_TIMEOUT', '远端查询超时')), 10000)
    signal.addEventListener('abort', abort, { once: true })
    client.exec(command, (error, stream) => {
      if (error) {
        finish(networkError('SSH_EXEC_FAILED', '远端查询失败'))
        return
      }
      channel = stream
      if (done) {
        stream.destroy()
        return
      }
      const data = (b: Buffer) => {
        size += b.length
        if (size > limit) {
          finish(new DesktopError({ code: 'OUTPUT_LIMIT', message: '远端结果超过限制' }))
          return
        }
        chunks.push(Buffer.from(b))
      }
      stream.on('data', data)
      stream.stderr.on('data', (b: Buffer) => {
        size += b.length
        if (size > limit) finish(networkError('OUTPUT_LIMIT', '远端结果超过限制'))
      })
      stream.on('exit', (value: number) => {
        code = value ?? 0
      })
      stream.once('close', () => finish())
      stream.once('error', () => finish(networkError('SSH_EXEC_FAILED', '远端查询失败')))
    })
  })
}
