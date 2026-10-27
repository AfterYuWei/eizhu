import { fail } from '@eizhu/contracts'
/** Notifications only wake durable incremental reads. Neither seq nor data is a confirmation. */
export class SseHints {
  private decoder = new TextDecoder('utf-8', { fatal: true })
  private buffer = ''
  private name = ''
  private data: string[] = []
  private bytes = 0
  private wake: () => void
  constructor(wake: () => void) {
    this.wake = wake
  }
  feed(chunk: Uint8Array): void {
    if (chunk.byteLength > 65536) fail('SYNC_PROTOCOL', '变化通知分块过大')
    try {
      this.buffer += this.decoder.decode(chunk, { stream: true })
    } catch {
      return fail('SYNC_PROTOCOL', '变化通知编码无效')
    }
    if (this.buffer.length > 65536) fail('SYNC_PROTOCOL', '变化通知缓冲超出上限')
    let index: number
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '')
      this.buffer = this.buffer.slice(index + 1)
      this.line(line)
    }
  }
  private line(line: string): void {
    if (!line) {
      if (this.name === 'ready' || this.name === 'change') {
        try {
          const value = JSON.parse(this.data.join('\n')) as { seq?: unknown }
          if (typeof value.seq !== 'number' || !Number.isSafeInteger(value.seq) || value.seq < 0)
            throw new Error()
        } catch {
          return fail('SYNC_PROTOCOL', '变化通知水位无效')
        }
        this.wake()
      }
      this.name = ''
      this.data = []
      this.bytes = 0
      return
    }
    if (line.startsWith(':')) return
    this.bytes += line.length
    if (this.bytes > 65536) fail('SYNC_PROTOCOL', '变化通知事件过大')
    const colon = line.indexOf(':'),
      field = colon < 0 ? line : line.slice(0, colon),
      value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') this.name = value
    if (field === 'data') this.data.push(value)
  }
}
