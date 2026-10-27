import { DesktopError, syncEventRequestSchema } from '@eizhu/contracts'
import type { EventStream } from './service.ts'

export class SyncEventRelay {
  private active?: {
    id: string
    controller: AbortController
    task: Promise<void>
    sequence: number
    ack?: () => void
  }
  private send: (message: unknown) => void
  private stream: EventStream
  constructor(send: (message: unknown) => void, stream: EventStream) {
    this.send = send
    this.stream = stream
  }
  open(id: string, raw: unknown): void {
    if (this.active) {
      this.send({ type: 'sync.events.end', id, error: { code: 'SYNC_BUSY', message: '变化通知连接已存在' } })
      return
    }
    let authorization: string
    try {
      authorization = syncEventRequestSchema.parse(raw).authorization
    } catch {
      this.send({ type: 'sync.events.end', id, error: { code: 'FORBIDDEN', message: '变化通知请求未授权' } })
      return
    }
    const controller = new AbortController(),
      active = {
        id,
        controller,
        task: Promise.resolve(),
        sequence: 0,
        ack: undefined as (() => void) | undefined,
      }
    this.active = active
    active.task = this.stream(
      authorization,
      controller.signal,
      (bytes) =>
        new Promise<void>((resolve, reject) => {
          if (controller.signal.aborted || bytes.byteLength > 65536) return reject(new Error('Stream closed'))
          const done = () => {
              clearTimeout(timer)
              controller.signal.removeEventListener('abort', cancel)
              active.ack = undefined
              resolve()
            },
            cancel = () => {
              clearTimeout(timer)
              active.ack = undefined
              reject(new Error('Stream closed'))
            },
            timer = setTimeout(() => controller.abort(), 10000)
          controller.signal.addEventListener('abort', cancel, { once: true })
          active.ack = done
          active.sequence++
          try {
            this.send({ type: 'sync.events.chunk', id, sequence: active.sequence, bytes })
          } catch {
            controller.abort()
          }
        }),
    )
      .then(
        () => this.send({ type: 'sync.events.end', id }),
        (error) =>
          this.send({
            type: 'sync.events.end',
            id,
            error:
              error instanceof DesktopError
                ? error.error
                : { code: 'ACCOUNT_UNAVAILABLE', message: '变化通知已中断' },
          }),
      )
      .catch(() => undefined)
      .finally(() => {
        if (this.active === active) this.active = undefined
      })
  }
  acknowledge(id: string, sequence: number): void {
    if (this.active?.id === id && this.active.sequence === sequence) this.active.ack?.()
  }
  abort(id: string): void {
    if (this.active?.id === id) this.active.controller.abort()
  }
  async close(): Promise<void> {
    this.active?.controller.abort()
    await this.active?.task
  }
}
