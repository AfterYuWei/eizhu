import net from 'node:net'
import type { Duplex } from 'node:stream'
import { DesktopError } from '@eizhu/contracts'
export const networkError = (
  code = 'SSH_CONNECTION_FAILED',
  message = 'SSH 连接失败，请检查网络、认证与服务器配置',
) => new DesktopError({ code, message })

/** 仅输出已识别的原因，不把可能包含凭据的库错误原文交给界面。 */
export function connectionError(
  error: { code?: string; level?: string; message: string },
  proxy = false,
): DesktopError {
  const prefix = proxy ? 'PROXY' : 'SSH'
  const target = proxy ? '代理服务器' : 'SSH 服务器'
  switch (error.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return networkError(`${prefix}_DNS_FAILED`, `无法解析${target}的域名`)
    case 'ECONNREFUSED':
      return networkError(`${prefix}_CONNECTION_REFUSED`, `${target}拒绝了连接，目标端口未接受请求`)
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return networkError(`${prefix}_NETWORK_UNREACHABLE`, `当前网络无法到达${target}`)
    case 'ETIMEDOUT':
      return networkError(`${prefix}_TIMEOUT`, `连接${target}超时，未在限定时间内收到响应`)
    case 'ECONNRESET':
    case 'EPIPE':
      return networkError(`${prefix}_CONNECTION_RESET`, `${target}在连接过程中关闭了通道`)
  }
  if (error.level === 'client-authentication')
    return networkError('SSH_AUTH_FAILED', '服务器未接受当前登录凭据或认证方式')
  if (/no matching (?:key exchange|host key|cipher|hmac|mac|compression)/i.test(error.message))
    return networkError('SSH_NEGOTIATION_FAILED', '客户端与服务器没有共同支持的 SSH 加密算法')
  if (error.level === 'client-timeout')
    return networkError('SSH_TIMEOUT', 'SSH 握手超时，服务器未完成协议协商或认证')
  return networkError(`${prefix}_CONNECTION_FAILED`, `${target}连接未完成，未能确定具体失败原因`)
}
export function addressBytes(host: string): Buffer {
  if (net.isIP(host) === 4) return Buffer.from([1, ...host.split('.').map(Number)])
  if (net.isIP(host) === 6) {
    if (host.includes('%')) throw networkError('INVALID_HOST', 'SOCKS5 不支持带区域标识的 IPv6 地址')
    const normalized = host.replace(
      /(\d+)\.(\d+)\.(\d+)\.(\d+)$/,
      (_m, a, b, c, d) =>
        ((Number(a) << 8) | Number(b)).toString(16) + ':' + ((Number(c) << 8) | Number(d)).toString(16),
    )
    const parts = normalized.split('::'),
      left = parts[0] ? parts[0].split(':') : [],
      right = parts[1] ? parts[1].split(':') : []
    const expanded = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    const b = Buffer.alloc(17)
    b[0] = 4
    expanded.forEach((v, i) => b.writeUInt16BE(parseInt(v, 16), 1 + i * 2))
    return b
  }
  const name = Buffer.from(host)
  if (name.length > 255) throw networkError('INVALID_HOST', '目标域名过长')
  return Buffer.concat([Buffer.from([3, name.length]), name])
}
/** A bounded handshake reader that preserves application bytes received with the last handshake packet. */
export class SocketReader {
  private buffer = Buffer.alloc(0)
  private waiting?: { size: number; resolve: (b: Buffer) => void; reject: (e: unknown) => void }
  private error?: unknown
  private socket: Duplex
  private onData = (data: Buffer) => {
    if (this.buffer.length + data.length > 65536) {
      this.onError(networkError('PROXY_PROTOCOL', '代理握手数据过大'))
      this.socket.destroy()
      return
    }
    this.buffer = Buffer.concat([this.buffer, data])
    this.pump()
  }
  private onError = (e?: unknown) => {
    this.error = e ?? networkError()
    this.waiting?.reject(this.error)
    this.waiting = undefined
  }
  constructor(socket: Duplex) {
    this.socket = socket
    socket.on('data', this.onData)
    socket.on('error', this.onError)
    socket.on('close', this.onError)
  }
  private pump(): void {
    const w = this.waiting
    if (!w || this.buffer.length < w.size) return
    this.waiting = undefined
    const b = this.buffer.subarray(0, w.size)
    this.buffer = this.buffer.subarray(w.size)
    w.resolve(b)
  }
  read(size: number): Promise<Buffer> {
    if (this.error) return Promise.reject(this.error)
    return new Promise((resolve, reject) => {
      this.waiting = { size, resolve, reject }
      this.pump()
    })
  }
  release(): void {
    this.socket.pause()
    this.socket.off('data', this.onData)
    this.socket.off('error', this.onError)
    this.socket.off('close', this.onError)
    if (this.buffer.length) this.socket.unshift(this.buffer)
    this.buffer = Buffer.alloc(0)
  }
}
export async function proxyHandshake(
  socket: Duplex,
  type: 'socks5' | 'http',
  host: string,
  port: number,
  username = '',
  password = '',
): Promise<void> {
  const reader = new SocketReader(socket)
  try {
    if (type === 'http') {
      if (/[\r\n\0]/.test(host)) throw networkError('INVALID_HOST', '目标主机无效')
      const authority = `${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`
      socket.write(
        `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${username ? 'Proxy-Authorization: Basic ' + Buffer.from(username + ':' + password).toString('base64') + '\r\n' : ''}\r\n`,
      )
      let header = ''
      while (!header.endsWith('\r\n\r\n')) {
        if (header.length >= 16384) throw networkError('PROXY_PROTOCOL', '代理响应过大')
        header += (await reader.read(1)).toString('latin1')
      }
      if (!/^HTTP\/1\.[01] 200\b/.test(header)) throw networkError('PROXY_REJECTED', 'HTTP 代理拒绝连接')
    } else {
      socket.write(Buffer.from([5, 1, username ? 2 : 0]))
      const greeting = await reader.read(2)
      if (greeting[0] !== 5 || greeting[1] !== (username ? 2 : 0))
        throw networkError('PROXY_AUTH_FAILED', 'SOCKS5 认证方式不匹配')
      if (username) {
        const u = Buffer.from(username),
          p = Buffer.from(password)
        if (u.length > 255 || p.length > 255) throw networkError('PROXY_AUTH_FAILED', '代理凭据过长')
        socket.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]))
        const auth = await reader.read(2)
        if (auth[0] !== 1 || auth[1] !== 0) throw networkError('PROXY_AUTH_FAILED', 'SOCKS5 认证失败')
      }
      const end = Buffer.alloc(2)
      end.writeUInt16BE(port)
      socket.write(Buffer.concat([Buffer.from([5, 1, 0]), addressBytes(host), end]))
      const head = await reader.read(4)
      if (head[0] !== 5 || head[1] !== 0) throw networkError('PROXY_REJECTED', 'SOCKS5 代理拒绝连接')
      const n = head[3] === 1 ? 4 : head[3] === 4 ? 16 : head[3] === 3 ? (await reader.read(1))[0] : 0
      if (!n) throw networkError('PROXY_PROTOCOL', 'SOCKS5 地址无效')
      await reader.read(n + 2)
    }
  } finally {
    reader.release()
  }
}
export async function socksTarget(socket: net.Socket): Promise<{ host: string; port: number }> {
  const r = new SocketReader(socket)
  try {
    const hello = await r.read(2)
    if (hello[0] !== 5 || hello[1] === 0) throw networkError()
    const methods = await r.read(hello[1])
    if (!methods.includes(0)) {
      socket.write(Buffer.from([5, 255]))
      throw networkError()
    }
    socket.write(Buffer.from([5, 0]))
    const head = await r.read(4)
    if (head[0] !== 5 || head[1] !== 1 || head[2] !== 0)
      throw networkError('SOCKS_UNSUPPORTED', '仅支持 SOCKS5 TCP CONNECT')
    let host: string
    if (head[3] === 1) host = [...(await r.read(4))].join('.')
    else if (head[3] === 4) {
      const b = await r.read(16)
      host = Array.from({ length: 8 }, (_, i) => b.readUInt16BE(i * 2).toString(16)).join(':')
    } else if (head[3] === 3) host = (await r.read((await r.read(1))[0])).toString('utf8')
    else throw networkError()
    const port = (await r.read(2)).readUInt16BE()
    if (!port || !host || host.includes('\0')) throw networkError()
    return { host, port }
  } finally {
    r.release()
  }
}
