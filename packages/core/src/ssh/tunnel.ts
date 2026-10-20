import net from 'node:net'
import type { Duplex } from 'node:stream'
import type { Client } from 'ssh2'
import type { TunnelConfig } from '@eizhu/contracts/models/api'
import { socksTarget, networkError } from './network.ts'
/** Each tunnel owns its listener and at most 32 socket/channel pairs. Pipe preserves half-close and backpressure. */
export class TunnelListener {
  private server?: net.Server
  private peers = new Set<Duplex>()
  private active = 0
  private stopped = false
  private closing?: Promise<void>
  private client: Client
  private config: TunnelConfig
  private update: (count: number) => void
  private bound = 0
  private remoteHandler?: (
    info: { destIP: string; destPort: number },
    accept: () => Duplex,
    reject: () => void,
  ) => void
  constructor(client: Client, config: TunnelConfig, update: (count: number) => void) {
    this.client = client
    this.config = config
    this.update = update
  }
  private acquire(socket: Duplex): { close: () => void; connect: (peer: Duplex) => void } | undefined {
    if (this.stopped || this.active >= 32) {
      socket.destroy()
      return
    }
    this.active++
    this.update(this.active)
    this.peers.add(socket)
    let closed = false,
      peer: Duplex | undefined
    const timer = setTimeout(() => close(), 10000)
    const close = () => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      this.active--
      this.peers.delete(socket)
      if (peer) this.peers.delete(peer)
      socket.destroy()
      peer?.destroy()
      this.update(this.active)
    }
    socket.once('error', close)
    socket.once('close', close)
    return {
      close,
      connect: (other) => {
        clearTimeout(timer)
        if (closed || this.stopped) {
          other.destroy()
          close()
          return
        }
        peer = other
        this.peers.add(other)
        other.once('close', close)
        other.once('error', close)
        socket.pipe(other).pipe(socket)
        socket.resume()
        other.resume()
      },
    }
  }
  async start(): Promise<number> {
    const c = this.config
    if (c.kind === 'remote') {
      this.remoteHandler = (info, accept, reject) => {
        if (
          this.stopped ||
          this.active >= 32 ||
          info.destPort !== this.bound ||
          info.destIP !== c.bind_host
        ) {
          reject()
          return
        }
        const channel = accept(),
          lease = this.acquire(channel)
        if (!lease) return
        const socket = net.connect({ host: c.target_host, port: c.target_port, allowHalfOpen: true })
        this.peers.add(socket)
        channel.once('close', () => {
          this.peers.delete(socket)
          socket.destroy()
        })
        socket.once('error', lease.close)
        socket.once('connect', () => lease.connect(socket))
      }
      this.client.on('tcp connection', this.remoteHandler)
      this.bound = await new Promise<number>((resolve, reject) =>
        this.client.forwardIn(c.bind_host, c.bind_port, (e, port) =>
          e ? reject(networkError('TUNNEL_BIND_FAILED', '远端拒绝监听')) : resolve(port),
        ),
      )
      if (this.stopped) throw networkError('CANCELLED', '隧道已停止')
      return this.bound
    }
    const server = net.createServer({ allowHalfOpen: true }, (socket) => {
      const lease = this.acquire(socket)
      if (!lease) return
      const run = async () => {
        const target =
          c.kind === 'dynamic' ? await socksTarget(socket) : { host: c.target_host, port: c.target_port }
        if (this.stopped || socket.destroyed) {
          lease.close()
          return
        }
        this.client.forwardOut(
          socket.remoteAddress ?? '127.0.0.1',
          socket.remotePort ?? 0,
          target.host,
          target.port,
          (error, channel) => {
            if (error || this.stopped || socket.destroyed) {
              if (c.kind === 'dynamic' && !socket.destroyed)
                socket.write(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]))
              channel?.destroy()
              lease.close()
              return
            }
            if (c.kind === 'dynamic') socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
            lease.connect(channel)
          },
        )
      }
      void run().catch(() => lease.close())
    })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', () => reject(networkError('TUNNEL_BIND_FAILED', '监听端口已占用或不可用')))
      server.listen(c.bind_port, c.bind_host, resolve)
    })
    server.on('error', () => undefined)
    this.bound = (server.address() as net.AddressInfo).port
    if (this.stopped) throw networkError('CANCELLED', '隧道已停止')
    return this.bound
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.stopped = true
    this.closing = (async () => {
      if (this.remoteHandler) this.client.off('tcp connection', this.remoteHandler)
      const pending: Array<Promise<void>> = []
      for (const p of this.peers) {
        if (p instanceof net.Socket && !p.closed)
          pending.push(new Promise<void>((resolve) => p.once('close', () => resolve())))
        p.destroy()
      }
      if (this.server) {
        const server = this.server
        pending.push(new Promise<void>((resolve) => server.close(() => resolve())))
      }
      if (this.config.kind === 'remote' && this.bound)
        pending.push(
          new Promise<void>((resolve, reject) => {
            let done = false
            const finish = (error?: unknown) => {
              if (done) return
              done = true
              clearTimeout(timer)
              this.client.off('close', closed)
              if (error) reject(error)
              else resolve()
            }
            const closed = () => finish()
            const timer = setTimeout(
              () => finish(networkError('TUNNEL_CLOSE_FAILED', '远端未确认释放监听')),
              3000,
            )
            this.client.once('close', closed)
            this.client.unforwardIn(this.config.bind_host, this.bound, (e) => {
              if (!e) finish()
            })
          }),
        )
      await Promise.all(pending)
      this.peers.clear()
      this.update(0)
    })()
    return this.closing
  }
}
