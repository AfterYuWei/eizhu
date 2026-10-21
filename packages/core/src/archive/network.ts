import { fail } from '@eizhu/contracts'
export const MAX_NETWORK_BYTES = 52 * 1024 * 1024
export type HttpRequest = { url: string; method: string; headers: Record<string, string>; body?: Uint8Array }
export type HttpResponse = { status: number; headers: Record<string, string>; body: Uint8Array }
export type Transport = (request: HttpRequest, signal: AbortSignal) => Promise<HttpResponse>
export function successful(response: HttpResponse): HttpResponse {
  if (response.status === 404) fail('OBJECT_NOT_FOUND', '云端对象不存在')
  if ([409, 412].includes(response.status)) fail('BACKUP_CONFLICT', '云端目录已变化，请刷新并预览云端版本')
  if ([401, 403].includes(response.status))
    fail('CLOUD_AUTH_REQUIRED', '云存储认证失败，请检查凭据或重新授权')
  if (response.status === 429) fail('CLOUD_RATE_LIMITED', '云存储请求过于频繁，请稍后重试')
  if (response.status < 200 || response.status >= 300)
    fail('CLOUD_REQUEST_FAILED', `云存储请求失败（HTTP ${response.status}）`)
  return response
}
export function jsonBody(response: HttpResponse): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body))
  } catch {
    return fail('CLOUD_DATA_INVALID', '云端响应格式无效')
  }
}
