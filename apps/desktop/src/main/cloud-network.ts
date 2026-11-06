import { session } from 'electron'
import { z } from 'zod'
import { MAX_NETWORK_BYTES } from '@eizhu/core/archive/network'
import type { HttpResponse } from '@eizhu/core/archive/network'
const request = z.strictObject({
  url: z.url().max(8192),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'MKCOL']),
  headers: z.record(z.string().max(256), z.string().max(32768)),
  body: z.instanceof(Uint8Array).optional(),
})
let backupSession: Electron.Session | undefined
let backupQueue: Promise<unknown> = Promise.resolve()

/** Fresh write connections prevent Chromium from replaying a lost upload on a reused socket. */
export function cloudRequest(
  raw: unknown,
  signal: AbortSignal,
  maxBytes = MAX_NETWORK_BYTES,
  networkSession?: Electron.Session,
): Promise<HttpResponse> {
  const data = request.parse(raw)
  // Account requests already own their connection queue and isolated session.
  if (networkSession) return performRequest(data, signal, maxBytes, networkSession)
  const task = backupQueue.then(async () => {
    if (signal.aborted) throw new Error('Backup request cancelled')
    backupSession ??= session.fromPartition('eizhu-backup-network', { cache: false })
    if (data.method !== 'GET') await backupSession.closeAllConnections()
    if (signal.aborted) throw new Error('Backup request cancelled')
    return performRequest(data, signal, maxBytes, backupSession)
  })
  backupQueue = task.then(
    () => undefined,
    () => undefined,
  )
  return task
}

/** Internal business-process transport. Electron supplies system proxy/TLS; redirects never forward credentials. */
async function performRequest(
  d: z.infer<typeof request>,
  signal: AbortSignal,
  maxBytes: number,
  networkSession: Electron.Session,
): Promise<HttpResponse> {
  const url = new URL(d.url)
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
    const response = await networkSession.fetch(url.href, {
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
