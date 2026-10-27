import { cloudRequest } from './cloud-network.ts'
import { accountRequest } from './account-network.ts'
import type { Transport } from '@eizhu/core/archive/network'
import { utilityProcess } from 'electron'
import type { UtilityProcess, MessagePortMain } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DesktopError, sameContext, eventSchemas, isDesktopEvent, offlineWorkspace, contextSchema } from '@eizhu/contracts'
import type { RuntimeContext, Failure, WorkspaceIdentity } from '@eizhu/contracts'
import { validateWorkspace } from '@eizhu/core/account/workspace'
import { stopProcess } from './process-shutdown.ts'

type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timer: NodeJS.Timeout }
export class RuntimeHost {
  private network = new Map<string, AbortController>()
  private child?: UtilityProcess
  private pending = new Map<string, Pending>()
  private stopping?: Promise<void>
  onEvent?: (name: 'eizhu-session-message'|'eizhu-sftp-message'|'eizhu-account-message', payload: unknown) => void
  readonly context: RuntimeContext
  workspace: WorkspaceIdentity
  private requestedWorkspace?: WorkspaceIdentity
  private root: string
  private directory: string
  private failed: () => void
  private key: Buffer
  private fixtureAccountTransport?: Transport
  constructor(root: string, directory: string, generation: number, failed: () => void, key: Buffer, workspace?: WorkspaceIdentity, fixtureAccountTransport?: Transport) {
    this.root = root
    this.directory = directory
    this.failed = failed
    this.key = key
    this.fixtureAccountTransport = fixtureAccountTransport
    this.requestedWorkspace = workspace === undefined ? undefined : validateWorkspace(workspace)
    this.workspace = this.requestedWorkspace ?? offlineWorkspace
    this.context = { runtimeId: randomUUID(), workspaceId: this.workspace.id, generation }
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
        if (message.type === 'cloud.abort'||message.type==='account.abort') { if(sameContext(message.context,this.context))this.network.get(message.id)?.abort(); return }
        if (message.type === 'cloud.request'||message.type==='account.request') {
          if (!sameContext(message.context,this.context) || typeof message.id !== 'string') return
          const responseType = message.type === 'account.request' ? 'account.response' : 'cloud.response'
          if(this.network.size>=8||this.network.has(message.id)){child.postMessage({type:responseType,id:message.id,error:true});return}
          const controller = new AbortController(); this.network.set(message.id,controller)
          const timeout = setTimeout(()=>controller.abort(),20000)
          const task = message.type === 'account.request' ? accountRequest(message.request, controller.signal, this.fixtureAccountTransport) : cloudRequest(message.request,controller.signal)
          void task.then(value=>{
            if(this.child===child)child.postMessage({type:responseType,id:message.id,value})
            if(responseType==='account.response')value.body.fill(0)
          },()=>{if(this.child===child)child.postMessage({type:responseType,id:message.id,error:true})}).catch(()=>undefined).finally(()=>{clearTimeout(timeout);this.network.delete(message.id)})
          return
        }

        if (
          message.type === 'event' &&
          sameContext(message.context, this.context) &&
          isDesktopEvent(message.name) &&
          ['eizhu-session-message','eizhu-sftp-message','eizhu-account-message'].includes(message.name)
        ) {
          const parsed = eventSchemas[message.name as 'eizhu-session-message'|'eizhu-sftp-message'|'eizhu-account-message'].safeParse(message.payload)
          if (parsed.success) this.onEvent?.(message.name, parsed.data)
        }
        if (message.type === 'ready') {
          clearTimeout(timer)
          try {
            const context = contextSchema.parse(message.context), workspace = validateWorkspace(message.workspace)
            if (context.runtimeId !== this.context.runtimeId || context.generation !== this.context.generation
              || context.workspaceId !== workspace.id || (this.requestedWorkspace && workspace.id !== this.requestedWorkspace.id))
              throw new Error('Unexpected workspace')
            this.workspace = workspace
            this.context.workspaceId = workspace.id
            resolve()
          } catch { reject(new Error('Runtime workspace identity mismatch')); child.kill() }
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
        workspace: this.requestedWorkspace,
        localHome:process.argv.includes('--smoke-test')?join(this.root,'stage4','local'):undefined,
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
      }, operation.startsWith('account.') ? 60_000 : 30_000)
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
    for(const controller of this.network.values())controller.abort()
    this.network.clear()
  }
  close(): Promise<void> {
    if (this.stopping) return this.stopping
    this.stopping = (this.child ? stopProcess(this.child, { graceful: 25000, forced: 5000 }) : Promise.resolve())
      .catch((cause) => {
        this.stopping = undefined
        throw cause
      })
      .finally(() => this.rejectPending())
    return this.stopping
  }
}
