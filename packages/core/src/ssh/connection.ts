import { Client } from 'ssh2'
import type { ClientChannel } from 'ssh2'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { createHash } from 'node:crypto'
import { DesktopError } from '@eizhu/contracts'
import type { ConnectionHop } from './plan.ts'
import { proxyHandshake, networkError, connectionError } from './network.ts'
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
    for (const [index, hop] of plan.entries()) {
      if (this.controller.signal.aborted) throw networkError('CANCELLED', '连接已取消')
      const p = hop.profile
      if (p.auth_type === 'agent' && process.platform !== 'win32' && !process.env.SSH_AUTH_SOCK)
        throw networkError('AGENT_UNAVAILABLE', '未找到系统 SSH Agent，请启动 Agent 或选择其他认证方式')
      const endpoint = `${p.host.includes(':') ? `[${p.host}]` : p.host}:${p.port}`
      const route = plan.length > 1 ? ` · 第 ${index + 1}/${plan.length} 跳` : ''
      hooks.stage('resolve', `连接目标 ${endpoint}${route}`)
      let sock: Duplex | undefined
      if (previous) {
        hooks.stage('proxy', `通过已连接的跳板转发至 ${endpoint}${route}`)
        sock = this.ownSocket(
          await new Promise<ClientChannel>((resolve, reject) =>
            previous!.forwardOut('127.0.0.1', 0, p.host, p.port, (e, s) =>
              e
                ? reject(networkError('JUMP_FAILED', '跳板服务器拒绝转发至目标，请检查转发权限与目标可达性'))
                : resolve(s),
            ),
          ),
        )
      } else if (hop.proxy.type === 'socks5' || hop.proxy.type === 'http') {
        hooks.stage(
          'proxy',
          `通过 ${hop.proxy.type.toUpperCase()} 代理 ${hop.proxy.host}:${hop.proxy.port} 连接 ${endpoint}`,
        )
        const proxy = hop.proxy
        const socket = this.ownSocket(
          net.connect({ host: proxy.host!, port: proxy.port!, allowHalfOpen: true }),
        )
        socket.setTimeout(hop.timeout, () => socket.destroy(networkError('PROXY_TIMEOUT', '代理连接超时')))
        await new Promise<void>((resolve, reject) => {
          socket.once('connect', resolve)
          socket.once('error', (error) =>
            reject(error instanceof DesktopError ? error : connectionError(error, true)),
          )
        })
        await proxyHandshake(
          socket,
          proxy.type as 'socks5' | 'http',
          p.host,
          p.port,
          proxy.username,
          p.proxy_password,
        ).catch((cause: unknown) => {
          if (cause instanceof DesktopError) throw cause
          throw cause instanceof Error
            ? connectionError(cause, true)
            : networkError('PROXY_CONNECTION_FAILED', '代理握手未完成')
        })
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
        let verificationFailure: DesktopError | undefined
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
        client.once('error', (error: Error & { code?: string; level?: string }) => {
          cleanup()
          reject(verificationFailure ?? connectionError(error))
        })
        client.once('close', () => {
          cleanup()
          reject(verificationFailure ?? networkError('SSH_CONNECTION_RESET', '服务器在连接完成前关闭了通道'))
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
          hooks.stage('establishing_ssh', `正在与 ${endpoint} 建立 SSH 通道${route}`)
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
              hooks.stage('host_key', `已收到 ${endpoint} 的主机密钥，正在核对指纹${route}`)
              const fingerprint =
                'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
              void hooks.verify(hop, fingerprint).then(
                (accepted) => {
                  if (!accepted)
                    verificationFailure = networkError(
                      'HOST_KEY_REJECTED',
                      '服务器主机指纹未获确认，连接已停止',
                    )
                  if (accepted)
                    hooks.stage('ssh_auth', `主机身份已确认，正在验证 ${p.username} 的登录凭据${route}`)
                  callback(accepted && !this.controller.signal.aborted)
                },
                (cause: unknown) => {
                  verificationFailure =
                    cause instanceof DesktopError
                      ? cause
                      : networkError('HOST_KEY_CHECK_FAILED', '未能读取或验证服务器主机指纹')
                  callback(false)
                },
              )
            },
          })
        } catch {
          this.closedClients.add(client)
          cleanup()
          reject(networkError('SSH_KEY_INVALID', 'SSH 认证配置或私钥无法读取'))
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
