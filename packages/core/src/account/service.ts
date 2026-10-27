import { z } from 'zod'
import {
  account,
  accountSetupSchema,
  accountTokenSchema,
  accountUserSchema,
  DesktopError,
  fail,
} from '@eizhu/contracts'
import type { AccountOperation, AccountStatus, WorkspaceIdentity } from '@eizhu/contracts'
import type { Transport } from '../archive/network.ts'
import type { AccountSession } from './repository.ts'
import type { AccountStorage } from './storage.ts'
import { AccountClient } from './client.ts'
import { accountWorkspace } from './workspace.ts'

const userWire = z.object(accountUserSchema.shape)
const errorCode = (cause: unknown) => (cause instanceof DesktopError ? cause.error.code : '')

/** One account provider per workspace/runtime; no login password or tokens enter renderer state. */
export class AccountService {
  private storage: AccountStorage
  private client: AccountClient
  private workspace: WorkspaceIdentity
  private controller = new AbortController()
  private running = new Set<Promise<unknown>>()
  private refreshing?: Promise<AccountSession>
  private timer?: ReturnType<typeof setTimeout>
  private closed = false
  private loggingOut = false
  private emit: (status: AccountStatus) => void
  constructor(
    storage: AccountStorage,
    transport: Transport,
    workspace: WorkspaceIdentity,
    emit: (status: AccountStatus) => void,
  ) {
    this.storage = storage
    this.client = new AccountClient(transport)
    this.workspace = workspace
    this.emit = emit
  }
  private run<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed)
      return Promise.reject(new DesktopError({ code: 'RUNTIME_CLOSED', message: '账号服务已关闭' }))
    const task = Promise.resolve().then(work)
    this.running.add(task)
    void task.then(
      () => this.running.delete(task),
      () => this.running.delete(task),
    )
    return task
  }
  private async publish(): Promise<void> {
    const status = await this.storage.status()
    if (!this.closed) this.emit(status)
  }
  private async current(): Promise<AccountSession> {
    const session = await this.storage.session(this.workspace)
    if (!session?.tokens) fail('ACCOUNT_NOT_LOGGED_IN', '登录已失效，请重新登录；本地数据仍可使用')
    return session
  }
  start(): void {
    if (this.workspace.id !== 'offline') void this.run(() => this.schedule()).catch(() => undefined)
  }
  private async schedule(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.closed) return
    const session = await this.storage.session(this.workspace)
    if (!session?.tokens || this.closed) return
    const delay = Math.max(1000, Math.min(2147483647, session.tokens.expiresAt - Date.now() - 60_000))
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.run(() => this.refresh()).catch(() => undefined)
    }, delay)
    this.timer.unref()
  }
  private refresh(): Promise<AccountSession> {
    if (this.loggingOut)
      return Promise.reject(new DesktopError({ code: 'ACCOUNT_BUSY', message: '账号正在退出' }))
    this.refreshing ??= (async () => {
      const previous = await this.current(),
        expected = previous.tokens!.refreshToken
      try {
        const response = await this.client.request(
          'refresh',
          'POST',
          this.controller.signal,
          accountTokenSchema,
          { refreshToken: expected },
        )
        if (response.user.id !== this.workspace.userId) fail('ACCOUNT_PROTOCOL', '账号刷新响应身份不匹配')
        const tokens = this.tokenExpiry(response)
        const next = await this.storage.update(this.workspace, expected, { tokens, user: response.user })
        await this.publish()
        await this.schedule()
        return next
      } catch (cause) {
        // Refresh rotates once. Any unknown result requires login rather than replaying an old refresh token.
        await this.storage.update(this.workspace, expected, { tokens: null }).catch((error: unknown) => {
          if (errorCode(error) !== 'ACCOUNT_SESSION_CHANGED') throw error
        })
        await this.publish()
        throw cause
      }
    })().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }
  private async refreshAfter(session: AccountSession): Promise<AccountSession> {
    const latest = await this.current()
    return latest.tokens!.refreshToken !== session.tokens!.refreshToken ? latest : this.refresh()
  }
  private tokenExpiry(response: z.infer<typeof accountTokenSchema>): NonNullable<AccountSession['tokens']> {
    const expiresAt = Date.now() + response.expiresIn * 1000
    if (!Number.isSafeInteger(expiresAt)) fail('ACCOUNT_PROTOCOL', '账号令牌有效期无效')
    return { accessToken: response.accessToken, refreshToken: response.refreshToken, expiresAt }
  }
  private async authorized<T>(
    path: string,
    method: 'GET' | 'POST' | 'PUT',
    schema?: z.ZodType<T>,
    body?: unknown,
    scope: 'auth' | 'sync' = 'auth',
    signal: AbortSignal = this.controller.signal,
  ): Promise<{ value: T; session: AccountSession }> {
    if (this.loggingOut) fail('ACCOUNT_BUSY', '账号正在退出')
    let session = await this.current()
    if (session.tokens!.expiresAt <= Date.now() + 30_000) session = await this.refreshAfter(session)
    try {
      return {
        value: await this.client.request(
          path,
          method,
          signal,
          schema,
          body,
          session.tokens!.accessToken,
          scope,
        ),
        session,
      }
    } catch (cause) {
      if (errorCode(cause) === 'ACCOUNT_DISABLED') {
        await this.storage.update(this.workspace, session.tokens!.refreshToken, { tokens: null })
        await this.publish()
        throw cause
      }
      if (errorCode(cause) !== 'ACCOUNT_NOT_LOGGED_IN') throw cause
      if (this.loggingOut) fail('ACCOUNT_BUSY', '账号正在退出')
      session = await this.refreshAfter(session)
      try {
        return {
          value: await this.client.request(
            path,
            method,
            signal,
            schema,
            body,
            session.tokens!.accessToken,
            scope,
          ),
          session,
        }
      } catch (retry) {
        if (['ACCOUNT_NOT_LOGGED_IN', 'ACCOUNT_DISABLED'].includes(errorCode(retry))) {
          await this.storage.update(this.workspace, session.tokens!.refreshToken, { tokens: null })
          await this.publish()
        }
        throw retry
      }
    }
  }
  syncRequest<T>(
    path: string,
    method: 'GET' | 'POST' | 'PUT',
    schema?: z.ZodType<T>,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.run(
      async () =>
        (
          await this.authorized(
            path,
            method,
            schema,
            body,
            'sync',
            signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal,
          )
        ).value,
    )
  }
  syncToken(): Promise<{ token: string; expiresAt: number }> {
    return this.run(async () => {
      let session = await this.current()
      if (session.tokens!.expiresAt <= Date.now() + 30_000) session = await this.refreshAfter(session)
      return { token: session.tokens!.accessToken, expiresAt: session.tokens!.expiresAt }
    })
  }
  authenticate(
    operation: 'account.login' | 'account.register',
    input: unknown,
  ): Promise<{ workspace: WorkspaceIdentity; account: AccountStatus }> {
    return this.run(async () => {
      const credentials = account[operation].input.parse(input)
      const setup = await this.client.request('setup', 'GET', this.controller.signal, accountSetupSchema)
      if (setup.required) fail('ACCOUNT_SETUP_REQUIRED', '账号服务尚未初始化，请管理员先在管理后台完成初始化')
      const response = await this.client.request(
        operation === 'account.login' ? 'login' : 'register',
        'POST',
        this.controller.signal,
        accountTokenSchema,
        credentials,
      )
      const workspace = accountWorkspace(response.user.id)
      const saved = await this.storage.acceptLogin(workspace, response.user, this.tokenExpiry(response))
      if (workspace.id === this.workspace.id) {
        await this.publish()
        await this.schedule()
      }
      return {
        workspace,
        account: {
          loggedIn: true,
          sessionState: 'authenticated',
          user: response.user,
          syncEnabled: saved.syncEnabled,
        },
      }
    })
  }
  prepareLogout(): Promise<void> {
    return this.run(async () => {
      this.loggingOut = true
      try {
        if (this.timer) clearTimeout(this.timer)
        await this.refreshing?.catch(() => undefined)
        const session = await this.storage.session(this.workspace)
        if (!session?.tokens) return
        const expected = session.tokens.refreshToken
        try {
          await this.client.request(
            'logout',
            'POST',
            this.controller.signal,
            undefined,
            { refreshToken: expected },
            session.tokens.accessToken,
          )
        } catch {
          /* Local logout still completes when the server cannot confirm revocation. */
        }
        await this.storage.update(this.workspace, expected, { tokens: null })
      } finally {
        this.loggingOut = false
      }
    })
  }
  execute(operation: AccountOperation, input: unknown): Promise<unknown> {
    return this.run(async () => {
      const data = account[operation].input.parse(input)
      switch (operation) {
        case 'account.status':
          return this.storage.status()
        case 'account.me': {
          const result = await this.authorized('me', 'GET', userWire)
          if (result.value.id !== this.workspace.userId) fail('ACCOUNT_PROTOCOL', '账号响应身份不匹配')
          await this.storage.update(this.workspace, result.session.tokens!.refreshToken, {
            user: result.value,
          })
          await this.publish()
          return result.value
        }
        case 'account.sendVerificationEmail':
          await this.authorized('email/send', 'POST')
          return
        case 'account.verifyEmail': {
          await this.authorized('email/verify', 'POST', undefined, data)
          const result = await this.authorized('me', 'GET', userWire)
          if (result.value.id !== this.workspace.userId) fail('ACCOUNT_PROTOCOL', '账号响应身份不匹配')
          await this.storage.update(this.workspace, result.session.tokens!.refreshToken, {
            user: result.value,
          })
          await this.publish()
          return
        }
        case 'account.requestPasswordReset':
          await this.client.request('password/forgot', 'POST', this.controller.signal, undefined, data)
          return
        case 'account.resetPassword': {
          await this.client.request('password/reset', 'POST', this.controller.signal, undefined, data)
          const reset = account['account.resetPassword'].input.parse(data)
          const current = await this.storage.session(this.workspace)
          if (current?.tokens && current.user.email.toLowerCase() === reset.email.trim().toLowerCase()) {
            await this.storage.update(this.workspace, current.tokens.refreshToken, { tokens: null })
            await this.publish()
          }
          return
        }
        default:
          return fail('FORBIDDEN', '账号登录与退出只能由主进程协调空间切换')
      }
    })
  }
  async close(): Promise<void> {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.controller.abort()
    await Promise.allSettled([...this.running])
  }
}
