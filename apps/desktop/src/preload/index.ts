import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  contextSchema,
  foundation,
  isFoundationOperation,
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
  if (!isFoundationOperation(operation))
    throw new DesktopError({ code: 'STAGE_NOT_READY', message: '该业务能力将在后续实施阶段开放' })
  const sentContext = context
  if (isFoundationOperation(operation)) input = foundation[operation].input.parse(input)
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
    : response.value
}
const api: Record<string, Record<string, unknown>> = Object.create(null)
for (const operation of [...Object.keys(foundation), ...reservedOperations]) {
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
// Session streaming is deliberately unavailable until resource ownership + binary backpressure land in stage 3.
api.session.subscribe = () => Promise.reject({ code: 'STAGE_NOT_READY', message: 'SSH 终端将在阶段 3 开放' })
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
