import { randomUUID } from 'node:crypto'
import type { AiTransport } from '@eizhu/core/agent/model'
import type { AgentExternal } from '@eizhu/core/agent/service'
import type { HttpResponse, Transport } from '@eizhu/core/archive/network'
import { DesktopError } from '@eizhu/contracts'
import { z } from 'zod'
import { join } from 'node:path'
import type { EventStream } from '@eizhu/core/sync/service'
import { RuntimeService } from '@eizhu/core/runtime/service'
import {
  contextSchema,
  requestSchema,
  failureOf,
  sameContext,
  workspaceIdentitySchema,
} from '@eizhu/contracts'

const port = process.parentPort!
let service: RuntimeService | undefined
let closing = false
const pendingNetwork = new Map<
  string,
  { resolve: (value: HttpResponse) => void; reject: (error: unknown) => void; cleanup: () => void }
>()
const networkTransport =
  (kind: 'cloud' | 'account'): Transport =>
  (request, signal) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error('Aborted'))
      const id = randomUUID(),
        abort = () => {
          pendingNetwork.delete(id)
          signal.removeEventListener('abort', abort)
          port.postMessage({ type: `${kind}.abort`, id, context: service!.context })
          reject(new DesktopError({ code: 'CANCELLED', message: '网络任务已停止' }))
        }
      signal.addEventListener('abort', abort, { once: true })
      pendingNetwork.set(id, { resolve, reject, cleanup: () => signal.removeEventListener('abort', abort) })
      port.postMessage({ type: `${kind}.request`, id, context: service!.context, request })
    })
const pendingStreams = new Map<
  string,
  {
    consume: (bytes: Uint8Array) => Promise<void>
    resolve: () => void
    reject: (error: unknown) => void
    cleanup: () => void
    sequence: number
    aborted: boolean
    kind: 'sync.events' | 'ai.stream'
  }
>()
const openStream = (
  kind: 'sync.events' | 'ai.stream',
  request: unknown,
  signal: AbortSignal,
  consume: (bytes: Uint8Array) => Promise<void>,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return resolve()
    const id = randomUUID(),
      abort = () => {
        const pending = pendingStreams.get(id)
        if (pending) pending.aborted = true
        port.postMessage({ type: `${kind}.abort`, id, context: service!.context })
      }
    signal.addEventListener('abort', abort, { once: true })
    pendingStreams.set(id, {
      consume,
      resolve,
      reject,
      cleanup: () => signal.removeEventListener('abort', abort),
      sequence: 0,
      aborted: false,
      kind,
    })
    port.postMessage({ type: `${kind}.open`, id, context: service!.context, request })
  })
const eventStream: EventStream = (authorization, signal, consume) =>
  openStream('sync.events', { authorization }, signal, consume)
const agentTransport: AiTransport = (request, signal, consume) =>
  openStream('ai.stream', request, signal, consume)
const agentPending = new Map<
  string,
  {
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
    onText?: (text: string) => void
    onTool?: (name: string, args: unknown) => Promise<unknown>
    onRevoke?: () => void
    cleanup: () => void
  }
>()
const agentRequest = (
  type: 'status' | 'run',
  input: unknown,
  signal?: AbortSignal,
  onText?: (text: string) => void,
  onTool?: (name: string, args: unknown) => Promise<unknown>,
  onRevoke?: () => void,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const id = randomUUID(),
      abort = () => port.postMessage({ type: 'ai.agent.abort', id, context: service!.context })
    if (signal?.aborted) {
      reject(new DesktopError({ code: 'CANCELLED', message: 'Agent已停止' }))
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    agentPending.set(id, {
      resolve,
      reject,
      onText,
      onTool,
      onRevoke,
      cleanup: () => signal?.removeEventListener('abort', abort),
    })
    port.postMessage({ type: 'ai.agent.' + type, id, input, context: service!.context })
  })
const agentExternal: AgentExternal = {
  status: async (clis) =>
    z
      .array(
        z.object({
          kind: z.enum(['codex', 'claude', 'deepseek']),
          path: z.string(),
          available: z.boolean(),
          message: z.string(),
        }),
      )
      .parse(await agentRequest('status', clis)),
  run: async (input, signal, onText, onTool, onRevoke) =>
    z
      .object({ nativeSession: z.string() })
      .parse(await agentRequest('run', input, signal, onText, onTool, onRevoke)),
}
const transport = networkTransport('cloud'),
  accountTransport = networkTransport('account')
port.on('message', async ({ data, ports }) => {
  try {
    if (['ai.agent.text', 'ai.agent.tool', 'ai.agent.revoked', 'ai.agent.end'].includes(data.type)) {
      const p = agentPending.get(data.id)
      if (!p || !service || !sameContext(data.context, service.context)) return
      if (data.type === 'ai.agent.revoked') {
        p.onRevoke?.()
        return
      }
      if (data.type === 'ai.agent.text') {
        p.onText?.(z.string().max(196608).parse(data.text))
        return
      }
      if (data.type === 'ai.agent.tool') {
        try {
          if (!p.onTool) throw new Error('No tool scope')
          const result = await p.onTool(z.string().parse(data.name), data.args)
          port.postMessage({
            type: 'ai.agent.tool.result',
            id: data.id,
            callId: data.callId,
            result,
            context: service.context,
          })
        } catch (error) {
          port.postMessage({
            type: 'ai.agent.tool.result',
            id: data.id,
            callId: data.callId,
            error: failureOf(error),
            context: service.context,
          })
        }
        return
      }
      agentPending.delete(data.id)
      p.cleanup()
      if (data.error) p.reject(new DesktopError(data.error))
      else p.resolve(data.result)
      return
    }
    if (['sync.events.chunk', 'sync.events.end', 'ai.stream.chunk', 'ai.stream.end'].includes(data.type)) {
      const p = pendingStreams.get(data.id)
      if (!p || !service || !sameContext(data.context, service.context)) {
        data.bytes?.fill(0)
        return
      }
      if (data.type.endsWith('.end')) {
        pendingStreams.delete(data.id)
        p.cleanup()
        if (data.error && !p.aborted) p.reject(new DesktopError(data.error))
        else p.resolve()
        return
      }
      if (p.aborted) {
        data.bytes?.fill(0)
        return
      }
      try {
        if (
          !(data.bytes instanceof Uint8Array) ||
          data.bytes.byteLength > 65536 ||
          data.sequence !== p.sequence + 1
        )
          throw new DesktopError({ code: 'SYNC_PROTOCOL', message: '变化通知通道顺序无效' })
        p.sequence = data.sequence
        await p.consume(data.bytes)
        port.postMessage({
          type: `${p.kind}.ack`,
          id: data.id,
          sequence: data.sequence,
          context: service.context,
        })
      } catch (error) {
        pendingStreams.delete(data.id)
        p.cleanup()
        port.postMessage({ type: `${p.kind}.abort`, id: data.id, context: service.context })
        p.reject(error)
      } finally {
        data.bytes?.fill(0)
      }
      return
    }
    if (data.type === 'cloud.response' || data.type === 'account.response') {
      const p = pendingNetwork.get(data.id)
      if (!p) {
        data.value?.body?.fill(0)
        return
      }
      pendingNetwork.delete(data.id)
      p.cleanup()
      if (data.error)
        p.reject(
          new DesktopError({
            code: 'CLOUD_REQUEST_FAILED',
            message: '云存储网络请求失败或超时，请检查网络、系统代理和 TLS 配置',
          }),
        )
      else p.resolve(data.value)
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
          localHome: z.string().optional(),
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
          verificationSync: join(input.workers, 'sync-engine.cjs'),
        },
        input.key,
        (name, payload) => port.postMessage({ type: 'event', context: input.context, name, payload }),
        input.localHome,
        transport,
        input.workspace,
        accountTransport,
        eventStream,
        agentTransport,
        agentExternal,
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
