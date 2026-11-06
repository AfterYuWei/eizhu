import { aiHttpRequestSchema, failureOf, DesktopError } from '@eizhu/contracts'
import type { AiTransport } from './model.ts'

/** One unacknowledged chunk per request; no unbounded cross-process stream queue. */
export class AiStreamRelay {
  private active = new Map<
    string,
    { controller: AbortController; sequence: number; ack?: () => void; task: Promise<void> }
  >()
  private send: (message: object) => void
  private transport: AiTransport
  constructor(send: (message: object) => void, transport: AiTransport) {
    this.send = send
    this.transport = transport
  }
  open(id: string, raw: unknown): void {
    if (this.active.size >= 4 || this.active.has(id)) {
      this.send({ type: 'ai.stream.end', id, error: { code: 'AI_BUSY', message: 'AI 网络请求过多' } })
      return
    }
    const parsed = aiHttpRequestSchema.safeParse(raw)
    if (!parsed.success) {
      this.send({ type: 'ai.stream.end', id, error: { code: 'FORBIDDEN', message: 'AI 网络请求无效' } })
      return
    }
    const a = {
      controller: new AbortController(),
      sequence: 0,
      ack: undefined as (() => void) | undefined,
      task: Promise.resolve(),
    }
    this.active.set(id, a)
    a.task = this.transport(
      parsed.data,
      a.controller.signal,
      (bytes) =>
        new Promise<void>((resolve, reject) => {
          if (a.controller.signal.aborted || bytes.byteLength > 65536) {
            reject(new DesktopError({ code: 'AI_STREAM_INTERRUPTED', message: 'AI 流已关闭' }))
            return
          }
          const finish = () => {
            clearTimeout(timer)
            a.controller.signal.removeEventListener('abort', abort)
            a.ack = undefined
            resolve()
          }
          const abort = () => {
            clearTimeout(timer)
            a.ack = undefined
            reject(new DesktopError({ code: 'CANCELLED', message: 'AI 请求已停止' }))
          }
          const timer = setTimeout(() => a.controller.abort(), 10000)
          a.controller.signal.addEventListener('abort', abort, { once: true })
          a.ack = finish
          this.send({ type: 'ai.stream.chunk', id, sequence: ++a.sequence, bytes })
        }),
    )
      .then(
        () => this.send({ type: 'ai.stream.end', id }),
        (error) => this.send({ type: 'ai.stream.end', id, error: failureOf(error) }),
      )
      .catch(() => {
        a.controller.abort()
      })
      .finally(() => this.active.delete(id))
  }
  acknowledge(id: string, sequence: number): void {
    const a = this.active.get(id)
    if (a?.sequence === sequence) a.ack?.()
  }
  abort(id: string): void {
    this.active.get(id)?.controller.abort()
  }
  async close(): Promise<void> {
    for (const a of this.active.values()) a.controller.abort()
    await Promise.allSettled([...this.active.values()].map((a) => a.task))
  }
}
