import { utilityProcess } from 'electron'
import type { UtilityProcess, MessagePortMain } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DesktopError, sameContext, eventSchemas, isDesktopEvent } from '@eizhu/contracts'
import type { RuntimeContext, Failure } from '@eizhu/contracts'
import { stopProcess } from './process-shutdown.ts'

type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timer: NodeJS.Timeout }
export class RuntimeHost {
  private child?: UtilityProcess
  private pending = new Map<string, Pending>()
  private stopping?: Promise<void>
  onEvent?: (name: 'eizhu-session-message', payload: unknown) => void
  readonly context: RuntimeContext
  private root: string
  private directory: string
  private failed: () => void
  private key: Buffer
  constructor(root: string, directory: string, generation: number, failed: () => void, key: Buffer) {
    this.root = root
    this.directory = directory
    this.failed = failed
    this.key = key
    this.context = { runtimeId: randomUUID(), workspaceId: 'offline', generation }
  }
  async start(): Promise<void> {
    const child = utilityProcess.fork(join(this.directory, 'runtime.cjs'), [], {
      serviceName: 'eizhu business',
      stdio: 'pipe',
    })
    this.child = child
    child.stdout?.on('data', () => undefined)
    child.stderr?.on('data', (data) => {
      if (process.argv.includes('--smoke-test')) process.stderr.write(data)
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Runtime initialization timed out'))
        child.kill()
      }, 30_000)
      child.on('message', (message) => {
        if (
          message.type === 'event' &&
          sameContext(message.context, this.context) &&
          isDesktopEvent(message.name) &&
          message.name === 'eizhu-session-message'
        ) {
          const parsed = eventSchemas['eizhu-session-message'].safeParse(message.payload)
          if (parsed.success) this.onEvent?.(message.name, parsed.data)
        }
        if (message.type === 'ready') {
          clearTimeout(timer)
          resolve()
        }
        if (message.type === 'fatal') {
          clearTimeout(timer)
          reject(new DesktopError(message.error))
          child.kill()
        }
        if (message.type !== 'response' || !sameContext(message.context, this.context)) return
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) pending.reject(new DesktopError(message.error as Failure))
        else pending.resolve(message.value)
      })
      child.once('exit', () => {
        clearTimeout(timer)
        this.child = undefined
        reject(new Error('Runtime exited before initialization'))
        this.rejectPending()
        if (!this.stopping) this.failed()
      })
      child.postMessage({
        type: 'init',
        context: this.context,
        root: this.root,
        workers: this.directory,
        key: this.key,
      })
    })
  }
  call<T>(operation: string, input?: unknown): Promise<T> {
    if (!this.child?.pid || this.stopping)
      return Promise.reject(
        new DesktopError({ code: 'RUNTIME_UNAVAILABLE', message: '业务进程不可用，请重启应用' }),
      )
    if (this.pending.size >= 256)
      return Promise.reject(new DesktopError({ code: 'QUEUE_FULL', message: '请求过多，请稍后重试' }))
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new DesktopError({ code: 'REQUEST_TIMEOUT', message: '请求超时，操作结果未知；请检查当前状态' }),
        )
      }, 30_000)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.child!.postMessage({ id, context: this.context, operation, input })
    })
  }
  bindTerminal(id: string, subscriptionId: string, port: MessagePortMain): void {
    if (!this.child || this.stopping) {
      port.close()
      return
    }
    this.child.postMessage({ type: 'terminal.bind', context: this.context, id, subscriptionId }, [port])
  }
  get processId(): number | undefined {
    return this.child?.pid
  }
  private rejectPending(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(
        new DesktopError({ code: 'RUNTIME_EXITED', message: '业务进程已退出，未保存的编辑内容仍保留' }),
      )
    }
    this.pending.clear()
  }
  close(): Promise<void> {
    if (this.stopping) return this.stopping
    this.stopping = (this.child ? stopProcess(this.child) : Promise.resolve())
      .catch((cause) => {
        this.stopping = undefined
        throw cause
      })
      .finally(() => this.rejectPending())
    return this.stopping
  }
}
