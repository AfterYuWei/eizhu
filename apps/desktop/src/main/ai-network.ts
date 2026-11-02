import { session } from 'electron'
import { aiHttpRequestSchema, DesktopError } from '@eizhu/contracts'
import type { AiTransport } from '@eizhu/core/agent/model'

const sessions: Array<{ network: Electron.Session; busy: boolean }> = []
/** Credentials never follow redirects. Electron supplies system proxy and TLS validation. */
export const aiNetwork: AiTransport = async (raw, signal, consume) => {
  const request = aiHttpRequestSchema.parse(raw),
    controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const timer = setTimeout(abort, 120000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let slot = sessions.find((s) => !s.busy)
  if (!slot && sessions.length < 4) {
    slot = {
      network: session.fromPartition(`eizhu-ai-network-${sessions.length}`, { cache: false }),
      busy: false,
    }
    sessions.push(slot)
  }
  if (!slot) {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    throw new DesktopError({ code: 'AI_BUSY', message: 'AI 网络请求过多' })
  }
  slot.busy = true
  try {
    // A dedicated bounded slot prevents Chromium from replaying a POST on a reused connection,
    // without closing another conversation's active stream.
    await slot.network.closeAllConnections()
    const response = await slot.network.fetch(request.url, {
      method: request.method,
      body: request.body,
      signal: controller.signal,
      headers: {
        accept: request.method === 'GET' ? 'application/json' : 'text/event-stream',
        ...(request.body ? { 'content-type': 'application/json' } : {}),
        ...(request.authorization ? { authorization: request.authorization } : {}),
      },
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new DesktopError({
        code:
          response.status === 401
            ? 'AI_UNAUTHORIZED'
            : response.status === 429
              ? 'AI_QUOTA_EXCEEDED'
              : 'AI_UNAVAILABLE',
        message:
          response.status === 401
            ? '登录或模型密钥已失效，请检查设置'
            : response.status === 429
              ? 'AI 额度不足或请求过于频繁'
              : response.status === 403
                ? '当前账号无权使用此模型'
                : 'AI 服务暂不可用，请检查配置或选择自配模型',
      })
    }
    if (
      !response.headers
        .get('content-type')
        ?.toLowerCase()
        .includes(request.method === 'GET' ? 'application/json' : 'text/event-stream')
    )
      throw new DesktopError({
        code: 'AI_PROTOCOL',
        message: '模型接口未返回所需格式，请检查协议和接口基础地址',
      })
    reader = response.body?.getReader()
    if (!reader) throw new DesktopError({ code: 'AI_PROTOCOL', message: '模型响应为空' })
    let total = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.byteLength
      if (total > 2 * 1024 * 1024)
        throw new DesktopError({ code: 'AI_PROTOCOL', message: '模型响应超过上限' })
      try {
        for (let offset = 0; offset < part.value.length; offset += 65536)
          await consume(part.value.subarray(offset, offset + 65536))
      } finally {
        part.value.fill(0)
      }
    }
  } catch (error) {
    if (error instanceof DesktopError) throw error
    throw new DesktopError({
      code: 'AI_STREAM_INTERRUPTED',
      message: signal.aborted ? 'AI 请求已停止' : 'AI 网络请求失败或超时，请检查网络与设置',
    })
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    await reader?.cancel().catch(() => undefined)
    try {
      await slot.network.closeAllConnections()
    } finally {
      slot.busy = false
    }
  }
}
