import type { SessionMessage } from '@eizhu/contracts/models/sessionMessage'
export interface BinaryPort {
  postMessage(value: unknown): void
  on(name: string, callback: (event: { data: unknown }) => void): unknown
  start(): void
  close(): void
}
const CAPACITY = 1024 * 1024,
  BATCH = 32768,
  CREDIT = 65536
/** Absolute byte positions make replay gaps explicit. ACKs only replenish bytes actually delivered. */
export class TerminalStream {
  private chunks: Buffer[] = []
  private size = 0
  private end = 0
  private sent = 0
  private acked = 0
  private port?: BinaryPort
  private timer?: NodeJS.Timeout
  private controls: SessionMessage[] = []
  private flow: (paused: boolean) => void
  constructor(flow: (paused: boolean) => void) {
    this.flow = flow
  }
  output(data: Buffer): void {
    this.chunks.push(Buffer.from(data))
    this.size += data.length
    this.end += data.length
    while (this.size > CAPACITY && this.chunks.length) {
      const excess = this.size - CAPACITY,
        first = this.chunks[0]
      if (first.length <= excess) {
        this.chunks.shift()
        this.size -= first.length
      } else {
        this.chunks[0] = Buffer.from(first.subarray(excess))
        this.size -= excess
      }
    }
    if (this.port && this.end - this.acked >= CAPACITY - CREDIT) this.flow(true)
    this.schedule()
  }
  event(message: SessionMessage): void {
    this.controls = this.controls.filter((m) => m.type !== message.type)
    this.controls.push(message)
    if (this.controls.length > 64) this.controls.shift()
    this.port?.postMessage({ type: 'event', message })
  }
  replay(): SessionMessage[] {
    return [...this.controls]
  }
  bind(port: BinaryPort): void {
    this.unbind()
    this.port = port
    this.acked = this.sent = this.end - this.size
    port.on('message', ({ data }) => {
      const d = data as { type?: string; offset?: number }
      if (d?.type !== 'ack' || !Number.isSafeInteger(d.offset) || d.offset! > this.sent) {
        this.unbind()
        return
      }
      if (d.offset! <= this.acked) return
      this.acked = d.offset!
      this.flow(false)
      this.schedule()
    })
    port.on('close', () => {
      if (this.port === port) this.unbind()
    })
    port.start()
    port.postMessage({ type: 'start', offset: this.sent, truncated: this.sent > 0 })
    this.schedule()
  }
  private schedule(): void {
    if (!this.port || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, 16)
  }
  private flush(): void {
    if (!this.port) return
    const start = this.end - this.size
    if (this.sent < start) {
      this.port.postMessage({ type: 'gap', offset: start })
      this.sent = this.acked = start
    }
    const count = Math.min(BATCH, CREDIT - (this.sent - this.acked), this.end - this.sent)
    if (count <= 0) return
    const data = Buffer.allocUnsafe(count)
    let skip = this.sent - start,
      offset = 0
    for (const chunk of this.chunks) {
      if (skip >= chunk.length) {
        skip -= chunk.length
        continue
      }
      const n = Math.min(chunk.length - skip, count - offset)
      chunk.copy(data, offset, skip, skip + n)
      offset += n
      skip = 0
      if (offset === count) break
    }
    this.sent += count
    this.port.postMessage({ type: 'data', offset: this.sent, bytes: new Uint8Array(data) })
    if (this.sent < this.end && this.sent - this.acked < CREDIT) this.schedule()
  }
  unbind(): void {
    const port = this.port
    this.port = undefined
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    port?.close()
    this.flow(false)
  }
  close(): void {
    this.unbind()
    this.chunks = []
    this.controls = []
    this.size = 0
  }
  get bufferedBytes(): number {
    return this.size
  }
}
