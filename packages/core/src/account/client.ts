import { z } from 'zod'
import { ACCOUNT_SERVER, accountHttpRequestSchema, DesktopError, fail } from '@eizhu/contracts'
import type { HttpResponse, Transport } from '../archive/network.ts'

const remoteError = z.object({ code: z.string().max(100) })
const messages: Record<string, [string, string]> = {
  INVALID_CREDENTIALS: ['ACCOUNT_INVALID_CREDENTIALS', '邮箱或密码不正确'],
  EMAIL_TAKEN: ['ACCOUNT_EMAIL_TAKEN', '该邮箱已被注册'],
  ACCOUNT_DISABLED: ['ACCOUNT_DISABLED', '账号已被禁用，请联系管理员'],
  UNAUTHENTICATED: ['ACCOUNT_NOT_LOGGED_IN', '登录已失效，请重新登录'],
  INVALID_REFRESH_TOKEN: ['ACCOUNT_NOT_LOGGED_IN', '登录已失效，请重新登录'],
  EMAIL_NOT_VERIFIED: ['EMAIL_NOT_VERIFIED', '请先完成邮箱验证'],
  INVALID_EMAIL_CODE: ['INVALID_EMAIL_CODE', '验证码无效或已过期，请重新获取'],
  PASSWORD_TOO_LONG: ['PASSWORD_TOO_LONG', '登录密码不能超过 72 个 UTF-8 字节'],
  PASSWORD_TOO_SHORT: ['PASSWORD_TOO_SHORT', '登录密码长度不足，请检查后重试'],
  ACCESS_DENIED: ['ACCOUNT_ACCESS_DENIED', '账号服务暂未开放此操作，请联系管理员'],
  VALIDATION_FAILED: ['ACCOUNT_VALIDATION_FAILED', '账号信息格式不正确，请检查后重试'],
  MAIL_NOT_CONFIGURED: ['ACCOUNT_MAIL_UNAVAILABLE', '邮件服务尚未配置，请联系管理员'],
}

function responseError(response: HttpResponse): DesktopError {
  let code = ''
  try {
    code = remoteError.parse(JSON.parse(new TextDecoder().decode(response.body))).code
  } catch {
    /* Raw server bodies never reach UI or diagnostics. */
  }
  const known = messages[code]
  if (known) return new DesktopError({ code: known[0], message: known[1] })
  if (response.status === 401)
    return new DesktopError({ code: 'ACCOUNT_NOT_LOGGED_IN', message: '登录已失效，请重新登录' })
  if (response.status === 403)
    return new DesktopError({
      code: 'ACCOUNT_ACCESS_DENIED',
      message: '账号服务暂未开放此操作，请联系管理员',
    })
  if (response.status === 429) {
    const seconds = Number(response.headers['retry-after'])
    return new DesktopError({
      code: 'RATE_LIMITED',
      message: '请求过于频繁，请稍后重试',
      details: {
        retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.ceil(seconds)) : 60,
      },
    })
  }
  return new DesktopError({
    code: 'ACCOUNT_UNAVAILABLE',
    message: '账号服务暂时不可用，本地数据已保留',
    retryable: response.status >= 500,
  })
}

export class AccountClient {
  private transport: Transport
  constructor(transport: Transport) {
    this.transport = transport
  }
  async request<T>(
    path: string,
    method: 'GET' | 'POST',
    signal: AbortSignal,
    schema?: z.ZodType<T>,
    body?: unknown,
    accessToken?: string,
  ): Promise<T> {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    let response: HttpResponse | undefined
    try {
      const request = accountHttpRequestSchema.parse({
        url: new URL(`api/auth/${path}`, ACCOUNT_SERVER).href,
        method,
        headers: {
          accept: 'application/json',
          ...(bytes ? { 'content-type': 'application/json' } : {}),
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: bytes,
      })
      try {
        response = await this.transport(request, signal)
      } catch {
        throw new DesktopError({
          code: signal.aborted ? 'CANCELLED' : 'ACCOUNT_UNAVAILABLE',
          message: signal.aborted ? '账号操作已取消' : '无法连接账号服务，本地数据已保留',
          retryable: !signal.aborted,
        })
      }
      if (response.body.byteLength > 131072) fail('ACCOUNT_PROTOCOL', '账号响应超出大小限制')
      if (response.status < 200 || response.status >= 300) throw responseError(response)
      if (!schema) return undefined as T
      try {
        return schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body)))
      } catch {
        return fail('ACCOUNT_PROTOCOL', '账号服务返回了无效数据')
      }
    } finally {
      bytes?.fill(0)
      response?.body.fill(0)
    }
  }
}
