import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  contextSchema,
  foundation,
  isFoundationOperation,
  local,
  ssh,
  isSshOperation,
  sessionMessageSchema,
  isLocalOperation,
  reservedOperations,
  sameContext,
  DesktopError,
  failureOf,
  eventSchemas,
  isDesktopEvent,
} from '@eizhu/contracts'
import type { Bootstrap, DesktopApi, DesktopEvents, RuntimeContext } from '@eizhu/contracts'

let context: RuntimeContext
let currentBootstrap: Bootstrap
const initial = ipcRenderer.invoke('eizhu:bootstrap').then((value: unknown) => {
  const result = foundation['app.bootstrap'].output.parse(value)
  context = result.context
  currentBootstrap = result
  return result
})
const listeners = new Map<string, Set<(payload: unknown) => void>>()
ipcRenderer.on('eizhu:context', (_event, value) => {
  const parsed = foundation['app.bootstrap'].output.safeParse(value)
  if (parsed.success) {
    currentBootstrap = parsed.data
    context = parsed.data.context
  }
})
ipcRenderer.on('eizhu:event', (_event, envelope) => {
  if (
    !context ||
    !contextSchema.safeParse(envelope.context).success ||
    !sameContext(context, envelope.context)
  )
    return
  const name: unknown = envelope.name
  if (typeof name !== 'string' || !isDesktopEvent(name)) return
  const payload = eventSchemas[name].safeParse(envelope.payload)
  if (!payload.success) return
  for (const listener of listeners.get(name) ?? []) {
    try {
      listener(payload.data)
    } catch {
      /* A renderer callback cannot disrupt other subscriptions. */
    }
  }
})

async function call(operation: string, input?: unknown): Promise<unknown> {
  await initial
  if (!isFoundationOperation(operation) && !isLocalOperation(operation) && !isSshOperation(operation))
    throw new DesktopError({ code: 'STAGE_NOT_READY', message: '该业务能力将在后续实施阶段开放' })
  const sentContext = context
  if (isFoundationOperation(operation)) input = foundation[operation].input.parse(input)
  else if (isLocalOperation(operation)) input = local[operation].input.parse(input)
  else if (isSshOperation(operation)) input = ssh[operation].input.parse(input)
  const id = crypto.randomUUID()
  const response = await ipcRenderer.invoke('eizhu:request', { id, context: sentContext, operation, input })
  if (response.id !== id) throw new DesktopError({ code: 'STALE_RESPONSE', message: '响应标识不匹配' })
  if (response.error) throw new DesktopError(response.error)
  if (operation === 'runtime.restart') {
    const restored = foundation['runtime.restart'].output.parse(response.value)
    if (!sameContext(restored, context))
      throw new DesktopError({ code: 'STALE_RESPONSE', message: '恢复响应已失效' })
    return restored
  }
  if (!sameContext(sentContext, context))
    throw new DesktopError({ code: 'WORKSPACE_CHANGED', message: '数据空间已变化，请重试' })
  if (!sameContext(response.context, sentContext))
    throw new DesktopError({ code: 'STALE_RESPONSE', message: '已丢弃过期响应' })
  return isFoundationOperation(operation)
    ? foundation[operation].output.parse(response.value)
    : isLocalOperation(operation)
      ? local[operation].output.parse(response.value)
      : isSshOperation(operation)
        ? ssh[operation].output.parse(response.value)
        : response.value
}
const api: Record<string, Record<string, unknown>> = Object.create(null)
for (const operation of new Set([
  ...Object.keys(foundation),
  ...Object.keys(local),
  ...Object.keys(ssh),
  ...reservedOperations,
])) {
  const [domain, method] = operation.split('.')
  api[domain] ??= Object.create(null)
  // Rejections cross contextBridge as plain DTOs; custom Error properties would be lost.
  api[domain][method] = (input?: unknown) =>
    call(operation, input).catch((cause) => Promise.reject(failureOf(cause)))
}
api.app.bootstrap = async (): Promise<Bootstrap> => {
  await initial.catch((cause) => Promise.reject(failureOf(cause)))
  return currentBootstrap
}
type Subscription = {
  id: string
  subscriptionId?: string
  port?: MessagePort
  callback: (message: import('@eizhu/contracts/models/sessionMessage').SessionMessage) => void | Promise<void>
  ready: () => void
  reject: (cause: unknown) => void
  context: RuntimeContext
  timer?: ReturnType<typeof setTimeout>
}
const streams = new Map<string, Subscription>()
ipcRenderer.on('eizhu:terminal-port', (event, envelope) => {
  const port = event.ports[0],
    entry = streams.get(envelope.subscriptionId)
  if (!port || !entry || !sameContext(entry.context, context) || !sameContext(envelope.context, context)) {
    port?.close()
    return
  }
  entry.port?.close()
  entry.port = port
  entry.subscriptionId = envelope.subscriptionId
  let decoder = new TextDecoder()
  let offset = 0,
    chain = Promise.resolve()
  port.onmessage = ({ data }) => {
    chain = chain
      .then(async () => {
        if (streams.get(entry.subscriptionId!) !== entry || !sameContext(entry.context, context)) return
        if (data.type === 'start' || data.type === 'gap') {
          offset = data.offset
          decoder = new TextDecoder()
          if (data.truncated || data.type === 'gap')
            await entry.callback({ type: 'output', data: '\r\n[较早的终端输出已超出重放缓存]\r\n' })
          return
        }
        if (data.type === 'data') {
          if (
            !(data.bytes instanceof Uint8Array) ||
            data.bytes.byteLength > 32768 ||
            data.offset !== offset + data.bytes.byteLength
          )
            throw new Error('Invalid terminal frame')
          const text = decoder.decode(data.bytes, { stream: true })
          offset = data.offset
          if (text) await entry.callback({ type: 'output', data: text })
          port.postMessage({ type: 'ack', offset })
          return
        }
        if (data.type === 'event') {
          const parsed = sessionMessageSchema.safeParse(data.message)
          if (parsed.success) {
            if (parsed.data.type === 'metadata') decoder = new TextDecoder()
            await entry.callback(parsed.data)
          }
        }
      })
      .catch(() => {
        port.close()
        streams.delete(entry.subscriptionId!)
      })
  }
  port.addEventListener('close', () => {
    if (streams.get(entry.subscriptionId!) === entry) {
      streams.delete(entry.subscriptionId!)
      void entry.callback({
        type: 'disconnect',
        payload: { reason: 'channel_closed', message: '终端通道已关闭，请手动重连' },
      })
    }
  })
  port.start()
  clearTimeout(entry.timer)
  entry.ready()
})
api.session.subscribe = async (input: { id: string }, callback: Subscription['callback']) => {
  await initial
  const { id } = ssh['session.subscribe'].input.parse(input)
  if (typeof callback !== 'function') throw new Error('Invalid callback')
  let ready!: () => void, reject!: (cause: unknown) => void
  const arrived = new Promise<void>((resolve, fail) => {
    ready = resolve
    reject = fail
  })
  void arrived.catch(() => undefined)
  const token = crypto.randomUUID()
  const entry: Subscription = { id, subscriptionId: token, callback, ready, reject, context: { ...context } }
  entry.timer = setTimeout(() => reject(new Error('终端通道初始化超时')), 10000)
  streams.set(token, entry)
  try {
    const subscriptionId = (await call('session.subscribe', { id, subscriptionId: token })) as string
    await arrived
    return subscriptionId
  } catch (cause) {
    clearTimeout(entry.timer)
    entry.port?.close()
    if (streams.get(token) === entry) streams.delete(token)
    throw failureOf(cause)
  }
}
api.session.unsubscribe = async (input: { id: string; subscriptionId: string }) => {
  const entry = streams.get(input.subscriptionId)
  if (entry?.subscriptionId === input.subscriptionId) {
    entry.port?.close()
    streams.delete(input.subscriptionId)
  }
  return call('session.unsubscribe', input).catch((cause) => Promise.reject(failureOf(cause)))
}
ipcRenderer.on('eizhu:context', () => {
  for (const [id, entry] of streams)
    if (!sameContext(entry.context, context)) {
      clearTimeout(entry.timer)
      entry.port?.close()
      entry.reject(new Error('运行实例已变化'))
      streams.delete(id)
      void entry.callback({
        type: 'disconnect',
        payload: { reason: 'runtime_restarted', message: '业务进程已重启，请手动重连' },
      })
    }
})

api.events = {
  on(name: keyof DesktopEvents, callback: (payload: unknown) => void): () => void {
    if (!isDesktopEvent(name) || typeof callback !== 'function') throw new Error('Unknown subscription')
    let entries = listeners.get(name)
    if (!entries) listeners.set(name, (entries = new Set()))
    if (entries.size >= 64) throw new Error('Subscription limit exceeded')
    entries.add(callback)
    return () => {
      entries.delete(callback)
      if (!entries.size) listeners.delete(name)
    }
  },
}
api.files = { pathForFile: (file: File) => webUtils.getPathForFile(file) }
contextBridge.exposeInMainWorld('eizhu', api as unknown as DesktopApi)
