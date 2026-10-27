import { net } from 'electron'
import { z } from 'zod'
import { MAX_NETWORK_BYTES } from '@eizhu/core/archive/network'
import type { HttpResponse } from '@eizhu/core/archive/network'
const request = z.strictObject({
  url: z.url().max(8192),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'MKCOL']),
  headers: z.record(z.string().max(256), z.string().max(32768)),
  body: z.instanceof(Uint8Array).optional(),
})
/** Internal business-process transport. Electron supplies system proxy/TLS; redirects never forward credentials. */
export async function cloudRequest(
  raw: unknown,
  signal: AbortSignal,
  maxBytes = MAX_NETWORK_BYTES,
  networkSession?: Electron.Session,
): Promise<HttpResponse> {
  const d = request.parse(raw),
    url = new URL(d.url)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (d.body?.byteLength ?? 0) > maxBytes
  )
    throw new Error('Invalid cloud request')
  // Chromium derives Host from the URL; SigV4 signs that same host without overriding a forbidden header.
  const headers = { ...d.headers }
  delete headers.host
  const body = d.body ? Buffer.from(d.body) : undefined
  const chunks: Uint8Array[] = []
  let total = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const fetch = networkSession ? networkSession.fetch.bind(networkSession) : net.fetch.bind(net)
    const response = await fetch(url.href, {
      method: d.method,
      headers,
      body,
      signal,
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'omit',
    })
    reader = response.body?.getReader()
    if (Number(response.headers.get('content-length')) > maxBytes)
      throw new Error('Cloud response exceeds limit')
    while (reader) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.byteLength
      if (total > maxBytes) throw new Error('Cloud response exceeds limit')
      chunks.push(part.value)
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.concat(chunks, total),
    }
  } finally {
    body?.fill(0)
    for (const chunk of chunks) chunk.fill(0)
    await reader?.cancel().catch(() => undefined)
  }
}
