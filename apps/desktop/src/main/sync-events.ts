import { session } from 'electron'
import { DesktopError, syncEventRequestSchema } from '@eizhu/contracts'
import type { EventStream } from '@eizhu/core/sync/service'

let network: Electron.Session | undefined
/** Each chunk must be consumed before the next read. No renderer owns this stream. */
export const syncEventStream: EventStream = (authorization, signal, consume) =>
  readSyncEvents(authorization, signal, consume)
export async function readSyncEvents(
  authorization: string,
  signal: AbortSignal,
  consume: (bytes: Uint8Array) => Promise<void>,
  fixtureUrl?: string,
): Promise<void> {
  syncEventRequestSchema.parse({ authorization })
  network ??= session.fromPartition('eizhu-sync-events', { cache: false })
  const controller = new AbortController(),
    abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(abort, 45000)
  }
  const connect = setTimeout(abort, 20000)
  try {
    const response = await network.fetch(fixtureUrl ?? 'https://eizhu.yuweinfo.com/api/sync/v2/events', {
      headers: { accept: 'text/event-stream', authorization },
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'manual',
      cache: 'no-store',
    })
    clearTimeout(connect)
    if (response.status !== 200) {
      await response.body?.cancel()
      throw new DesktopError({
        code:
          response.status === 401
            ? 'ACCOUNT_NOT_LOGGED_IN'
            : response.status === 403
              ? 'ACCOUNT_ACCESS_DENIED'
              : response.status === 429
                ? 'RATE_LIMITED'
                : 'ACCOUNT_UNAVAILABLE',
        message:
          response.status === 401
            ? '登录已失效，请重新登录'
            : response.status === 403
              ? '账号变化通知暂不可用，请确认邮箱与服务权限'
              : '变化通知连接暂不可用；定时增量核对继续运行',
      })
    }
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream'))
      throw new DesktopError({ code: 'SYNC_PROTOCOL', message: '变化通知响应格式无效' })
    reader = response.body?.getReader()
    if (!reader) throw new Error()
    while (!controller.signal.aborted) {
      arm()
      const chunk = await reader.read()
      if (idle) clearTimeout(idle)
      if (chunk.done) return
      try {
        for (let offset = 0; offset < chunk.value.length; offset += 65536)
          await consume(chunk.value.subarray(offset, offset + 65536))
      } finally {
        chunk.value.fill(0)
      }
    }
  } catch (error) {
    if (signal.aborted) return
    if (error instanceof DesktopError) throw error
    throw new DesktopError({
      code: 'ACCOUNT_UNAVAILABLE',
      message: '变化通知连接已中断；定时增量核对继续运行',
      retryable: true,
    })
  } finally {
    clearTimeout(connect)
    if (idle) clearTimeout(idle)
    signal.removeEventListener('abort', abort)
    controller.abort()
    await reader?.cancel().catch(() => undefined)
  }
}
