import { foundation, fail, sameContext } from '@eizhu/contracts'
import type { RpcRequest, RuntimeContext } from '@eizhu/contracts'
import { WorkerClient } from '../workers/client.ts'
import { ResourceScope } from './scope.ts'
import { Client } from 'ssh2'

export class RuntimeService {
  private scope = new ResourceScope()
  private database: WorkerClient
  private compute: WorkerClient
  readonly context: RuntimeContext
  constructor(context: RuntimeContext, root: string, paths: { database: string; compute: string }) {
    this.context = context
    this.database = new WorkerClient(paths.database, { root }, 64)
    this.compute = new WorkerClient(paths.compute, undefined, 8)
    this.scope.own(() => this.database.close())
    this.scope.own(() => this.compute.close())
  }
  async execute(request: RpcRequest): Promise<unknown> {
    if (!sameContext(request.context, this.context)) fail('WORKSPACE_CHANGED', '数据空间已变化，请重试')
    if (this.scope.controller.signal.aborted) fail('RUNTIME_CLOSED', '业务进程正在关闭')
    switch (request.operation) {
      case 'runtime.health':
        await this.database.call('health')
        return { context: this.context, schema: 1, workers: 2 }
      case 'workspace.status':
        return { id: this.context.workspaceId, generation: this.context.generation, userId: 0 }
      case 'settings.read':
        return this.database.call('settings.read')
      case 'settings.write':
        return this.database.call('settings.write', foundation['settings.write'].input.parse(request.input))
      case 'runtime.smoke': {
        const client = new Client()
        client.end()
        return {
          ...(await this.compute.call<{ kdf: boolean; crypto: boolean }>('smoke', undefined, {
            signal: this.scope.controller.signal,
          })),
          ssh2: true,
        }
      }
      default:
        return fail('STAGE_NOT_READY', '该业务能力将在后续实施阶段开放')
    }
  }
  close(): Promise<void> {
    return this.scope.close()
  }
}
