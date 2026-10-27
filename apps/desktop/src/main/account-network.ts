import { accountHttpRequestSchema, syncHttpRequestSchema } from '@eizhu/contracts'
import type { HttpResponse, Transport } from '@eizhu/core/archive/network'
import { cloudRequest } from './cloud-network.ts'
import { session } from 'electron'

let networkSession: Electron.Session | undefined
let queue: Promise<unknown> = Promise.resolve()

/** Serialize this small control plane so a fresh write connection cannot close another account request. */
export function accountHttp(
  request: import('@eizhu/core/archive/network').HttpRequest,
  signal: AbortSignal,
): Promise<HttpResponse> {
  const task = queue.then(async () => {
    if (signal.aborted) throw new Error('Account request cancelled')
    networkSession ??= session.fromPartition('eizhu-account-network', { cache: false })
    // Chromium may resend a POST on a reused connection if its response was lost.
    // A fresh connection prevents that replay while retaining system proxy/TLS handling.
    if (request.method !== 'GET') await networkSession.closeAllConnections()
    if (signal.aborted) throw new Error('Account request cancelled')
    return cloudRequest(request, signal, request.url.includes('/api/sync/v2/') ? 50*1024*1024 : 131072, networkSession)
  })
  queue = task.then(
    () => undefined,
    () => undefined,
  )
  return task
}
export async function closeAccountNetwork(): Promise<void> {
  await queue
  await networkSession?.closeAllConnections()
}

/** Production always uses the fixed HTTPS account origin. Injection is owned by isolated smoke tests. */
export async function accountRequest(
  raw: unknown,
  signal: AbortSignal,
  fixture?: Transport,
): Promise<HttpResponse> {
  const request = accountHttpRequestSchema.safeParse(raw).success ? accountHttpRequestSchema.parse(raw) : syncHttpRequestSchema.parse(raw)
  try {
    return await (fixture ? fixture(request, signal) : accountHttp(request, signal))
  } finally {
    request.body?.fill(0)
  }
}
