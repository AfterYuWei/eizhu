import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { DesktopError, failureOf } from '@eizhu/contracts'
import type { Failure } from '@eizhu/contracts'

type Job = {
  id: string
  operation: string
  input: unknown
  resolve: (value: unknown) => void
  reject: (cause: unknown) => void
  cancelled?: boolean
  cleanup?: () => void
}
type Pending = Job & { timer: NodeJS.Timeout }
const cancelled = () => new DesktopError({ code: 'CANCELLED', message: '任务已取消' })
function wipeBytes(value: unknown, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (value instanceof Uint8Array) value.fill(0)
  else if (value instanceof ArrayBuffer) new Uint8Array(value).fill(0)
  else for (const nested of Object.values(value)) wipeBytes(nested, seen)
}
/** One active job; bounded waiting queue. A timeout terminates the worker, never replays a write. */
export class WorkerClient {
  private worker: Worker
  private pending = new Map<string, Pending>()
  private queue: Job[] = []
  private closed = false
  private closing?: Promise<void>
  private readonly capacity: number
  constructor(path: string, workerData: unknown, capacity = 16) {
    this.capacity = capacity
    this.worker = new Worker(path, { workerData })
    this.worker.on('message', (message: { id: string; value?: unknown; error?: Failure }) => {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      pending.cleanup?.()
      if (pending.cancelled) {
        wipeBytes(message.value)
        pending.reject(cancelled())
      } else if (message.error) pending.reject(new DesktopError(message.error))
      else pending.resolve(message.value)
      this.pump()
    })
    this.worker.on('error', () => this.rejectAll('业务线程异常退出'))
    this.worker.on('exit', () => this.rejectAll('业务线程已退出'))
  }
  call<T>(operation: string, input?: unknown, options: { signal?: AbortSignal } = {}): Promise<T> {
    const signal = options.signal
    if (signal?.aborted) return Promise.reject(cancelled())
    if (this.closed || this.closing)
      return Promise.reject(new DesktopError({ code: 'WORKER_CLOSED', message: '业务线程不可用' }))
    if (this.queue.length >= this.capacity)
      return Promise.reject(
        new DesktopError({ code: 'QUEUE_FULL', message: '任务队列已满，请稍后重试', retryable: true }),
      )
    return new Promise<T>((resolve, reject) => {
      const job: Job = { id: randomUUID(), operation, input, resolve: (value) => resolve(value as T), reject }
      if (signal) {
        const abort = () => {
          const index = this.queue.indexOf(job)
          if (index >= 0) {
            this.queue.splice(index, 1)
            job.cleanup?.()
            reject(cancelled())
          } else job.cancelled = true // An active native computation must finish before cancellation settles.
        }
        signal.addEventListener('abort', abort, { once: true })
        job.cleanup = () => signal.removeEventListener('abort', abort)
      }
      this.queue.push(job)
      this.pump()
    })
  }
  private pump(): void {
    if (this.closed || this.pending.size) return
    const job = this.queue.shift()
    if (!job) return
    const timer = setTimeout(() => {
      this.rejectAll('业务线程响应超时')
      void this.worker.terminate()
    }, 60_000)
    this.pending.set(job.id, Object.assign(job, { timer }))
    try {
      this.worker.postMessage({ id: job.id, operation: job.operation, input: job.input })
      job.input = undefined
    } catch {
      this.pending.delete(job.id)
      clearTimeout(timer)
      job.cleanup?.()
      job.reject(new DesktopError({ code: 'BAD_REQUEST', message: '工作线程输入无法序列化' }))
      this.pump()
    }
  }
  private rejectAll(message: string): void {
    this.closed = true
    const error = new DesktopError({ code: 'WORKER_CLOSED', message })
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.cleanup?.()
      pending.reject(error)
    }
    this.pending.clear()
    for (const job of this.queue.splice(0)) {
      job.cleanup?.()
      job.reject(error)
    }
  }
  async close(): Promise<void> {
    this.closing ??= (async () => {
      if (!this.closed) {
        // Shutdown is a barrier behind all accepted jobs, even when the ordinary queue is full.
        await new Promise<void>((resolve, reject) => {
          this.queue.push({
            id: randomUUID(),
            operation: 'close',
            input: undefined,
            resolve: () => resolve(),
            reject,
          })
          this.pump()
        }).catch(() => undefined)
        this.rejectAll('业务线程已关闭')
      }
      await this.worker.terminate()
    })()
    return this.closing
  }
}

export async function answerWorker(
  message: { id: string; operation: string; input: unknown },
  execute: (operation: string, input: unknown) => unknown | Promise<unknown>,
): Promise<{ id: string; value?: unknown; error?: Failure }> {
  try {
    return { id: message.id, value: await execute(message.operation, message.input) }
  } catch (cause) {
    return { id: message.id, error: failureOf(cause) }
  }
}
