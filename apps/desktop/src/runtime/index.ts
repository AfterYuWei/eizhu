import { randomUUID } from 'node:crypto'
import type { HttpResponse, Transport } from '@eizhu/core/archive/network'
import { DesktopError } from '@eizhu/contracts'
import { z } from 'zod'
import { join } from 'node:path'
import { RuntimeService } from '@eizhu/core/runtime/service'
import { contextSchema, requestSchema, failureOf, sameContext, workspaceIdentitySchema } from '@eizhu/contracts'

const port = process.parentPort!
let service: RuntimeService | undefined
let closing = false
const pendingNetwork = new Map<string,{resolve:(value:HttpResponse)=>void;reject:(error:unknown)=>void;cleanup:()=>void}>()
const networkTransport = (kind: 'cloud' | 'account'): Transport => (request, signal) => new Promise((resolve,reject)=>{
  if(signal.aborted)return reject(new Error('Aborted'))
  const id=randomUUID(), abort=()=>{pendingNetwork.delete(id);signal.removeEventListener('abort',abort);port.postMessage({type:`${kind}.abort`,id,context:service!.context});reject(new DesktopError({code:'CANCELLED',message:'网络任务已停止'}))}
  signal.addEventListener('abort',abort,{once:true})
  pendingNetwork.set(id,{resolve,reject,cleanup:()=>signal.removeEventListener('abort',abort)})
  port.postMessage({type:`${kind}.request`,id,context:service!.context,request})
})
const transport = networkTransport('cloud'), accountTransport = networkTransport('account')
port.on('message', async ({ data, ports }) => {
  try {
    if(data.type==='cloud.response'||data.type==='account.response'){
      const p=pendingNetwork.get(data.id);if(!p){data.value?.body?.fill(0);return}
      pendingNetwork.delete(data.id);p.cleanup()
      if(data.error)p.reject(new DesktopError({code:'CLOUD_REQUEST_FAILED',message:'云存储网络请求失败或超时，请检查网络、系统代理和 TLS 配置'}));else p.resolve(data.value)
      return
    }
    if (data.type === 'init') {
      if (service || closing) throw new Error('Already initialized')
      const input = z
        .strictObject({
          type: z.literal('init'),
          context: contextSchema,
          root: z.string(),
          workers: z.string(),
          key: z.instanceof(Uint8Array),
          localHome:z.string().optional(),
          workspace: workspaceIdentitySchema.optional(),
        })
        .parse(data)
      service = new RuntimeService(
        input.context,
        input.root,
        {
          database: join(input.workers, 'database.cjs'),
          compute: join(input.workers, 'compute.cjs'),
          verification: join(input.workers, 'stage2.cjs'),
          verification3: join(input.workers, 'stage3.cjs'),
          verificationAccount: join(input.workers, 'account-foundation.cjs'),
        },
        input.key,
        (name, payload) => port.postMessage({ type: 'event', context: input.context, name, payload }),
        input.localHome,
        transport,
        input.workspace,
        accountTransport,
      )
      input.key.fill(0)
      const workspace = await service.initialize()
      await service.execute({
        id: crypto.randomUUID(),
        context: input.context,
        operation: 'runtime.health',
        input: undefined,
      })
      port.postMessage({ type: 'ready', context: service.context, workspace })
      service.startBackground()
      return
    }
    if (data.type === 'terminal.bind') {
      const channel = ports[0]
      try {
        if (!service || closing || !sameContext(contextSchema.parse(data.context), service.context))
          throw new Error('Stale context')
        await service.bindTerminal(z.uuid().parse(data.id), z.uuid().parse(data.subscriptionId), channel)
      } catch {
        channel?.close()
      }
      return
    }
    if (data.type === 'shutdown') {
      closing = true
      await service?.close()
      port.postMessage({ type: 'closed' })
      process.exit(0)
    }
    const request = requestSchema.parse(data)
    if (!service || closing) throw new Error('Runtime not ready')
    try {
      port.postMessage({
        type: 'response',
        id: request.id,
        context: request.context,
        value: await service.execute(request),
      })
    } catch (cause) {
      port.postMessage({
        type: 'response',
        id: request.id,
        context: request.context,
        error: failureOf(cause),
      })
    }
  } catch {
    port.postMessage({ type: 'fatal', error: { code: 'RUNTIME_INIT_FAILED', message: '业务进程初始化失败' } })
  }
})
