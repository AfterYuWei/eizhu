import { ZodError } from 'zod'
export interface Failure {
  code: string
  message: string
  retryable?: boolean
  details?: unknown
  session_id?: string
  stage?: string
  references?: unknown
}

export class DesktopError extends Error {
  readonly error: { code: string; message: string }
  readonly retryable: boolean
  readonly details?: unknown
  readonly sessionId?: string
  readonly stage?: string
  readonly references?: unknown
  constructor(failure: Failure) {
    super(failure.message)
    this.name = 'DesktopError'
    this.error = { code: failure.code, message: failure.message }
    this.retryable = failure.retryable ?? false
    this.details = failure.details
    this.sessionId = failure.session_id
    this.stage = failure.stage
    this.references = failure.references
  }
}

export function normalizeCommandError(cause: unknown): DesktopError {
  if (cause instanceof DesktopError) return cause
  const value = cause as Partial<Failure> | null
  return new DesktopError({
    ...value,
    code: value?.code ?? 'INTERNAL',
    message: value?.message ?? '操作失败',
  })
}

/** Never serialize raw library errors, stacks, input arguments or credentials. */
export function failureOf(cause: unknown): Failure {
  if (cause instanceof ZodError) return { code: 'BAD_REQUEST', message: '请求或响应格式不符合契约' }
  if (cause instanceof DesktopError)
    return {
      ...cause.error,
      retryable: cause.retryable,
      stage: cause.stage,
      session_id: cause.sessionId,
      references: cause.references,
      details: cause.details,
    }
  return { code: 'INTERNAL', message: '操作失败，请查看诊断日志' }
}

export function fail(code: string, message: string): never {
  throw new DesktopError({ code, message })
}
