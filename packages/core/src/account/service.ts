import { z } from 'zod'
import {
  account,
  masterKeyEnvelopeSchema,
  masterParametersSchema,
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
import type { WorkerClient } from '../workers/client.ts'
import { recoveryCredential, type MasterKeys } from './crypto.ts'
import { randomBytes } from 'node:crypto'
import { accountWorkspace } from './workspace.ts'

const userWire = z.object(accountUserSchema.shape)
const masterSession = z.strictObject({ tokens: accountTokenSchema, keys: masterKeyEnvelopeSchema })
type Created = { credential: string; recoveryHash: string; key: Uint8Array; keys: MasterKeys }
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
  private compute?: Pick<WorkerClient, 'call'>
  constructor(
    storage: AccountStorage,
    transport: Transport,
    workspace: WorkspaceIdentity,
    emit: (status: AccountStatus) => void,
    compute?: Pick<WorkerClient, 'call'>,
  ) {
    this.compute = compute
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
      let key: Uint8Array | undefined
      let response: z.infer<typeof masterSession>
      try {
        if (operation === 'account.register') {
          const registration = account['account.register'].input.parse(input)
          const created = await this.crypto<Created>('create', { password: registration.password })
          key = created.key
          response = await this.client.request(
            'master/register',
            'POST',
            this.controller.signal,
            masterSession,
            {
              email: registration.email,
              ticket: registration.ticket,
              credential: created.credential,
              keys: created.keys,
              recoveryHash: created.recoveryHash,
            },
          )
        } else {
          const parameters = await this.client.request(
            'master/parameters',
            'POST',
            this.controller.signal,
            masterParametersSchema,
            { email: credentials.email },
          )
          const derived = await this.crypto<{ credential: string }>('credential', {
            password: credentials.password,
            parameters,
          })
          response = await this.client.request(
            'master/login',
            'POST',
            this.controller.signal,
            masterSession,
            { email: credentials.email, credential: derived.credential },
          )
          if (response.keys.cryptoId !== parameters.cryptoId || response.keys.salt !== parameters.salt)
            fail('ACCOUNT_PROTOCOL', '登录期间加密参数已变化，请重新登录')
          key = (
            await this.crypto<{ key: Uint8Array }>('open', {
              password: credentials.password,
              keys: response.keys,
            })
          ).key
        }
        const workspace = accountWorkspace(response.tokens.user.id)
        const saved = await this.storage.acceptLogin(
          workspace,
          response.tokens.user,
          this.tokenExpiry(response.tokens),
          {
            cachedSyncKey: {
              key: Buffer.from(key.buffer, key.byteOffset, key.byteLength).toString('hex'),
              revision: response.keys.revision,
            },
            masterKeys: response.keys,
          },
        )
        if (workspace.id === this.workspace.id) {
          await this.publish()
          await this.schedule()
        }
        return {
          workspace,
          account: {
            loggedIn: true,
            sessionState: 'authenticated',
            user: response.tokens.user,
            syncEnabled: saved.syncEnabled,
          },
        }
      } finally {
        key?.fill(0)
      }
    })
  }
  private async crypto<T>(
    operation: string,
    input: Record<string, unknown> & { key?: Uint8Array },
  ): Promise<T> {
    if (!this.compute) fail('ACCOUNT_PROTOCOL', '主密码计算 Worker 不可用')
    try {
      return await this.compute.call<T>(`master.${operation}`, input, { signal: this.controller.signal })
    } finally {
      input.key?.fill(0)
    }
  }
  private async recoverable(email: string): Promise<AccountSession> {
    const session = await this.storage.session(this.workspace)
    if (
      !session?.cachedSyncKey ||
      !session.masterKeys ||
      session.user.email.toLowerCase() !== email.trim().toLowerCase()
    )
      fail('DEVICE_RECOVERY_REQUIRED', '请在仍可解锁数据的设备上恢复主密码；邮箱验证码不能单独恢复云端数据')
    return session
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
        case 'account.requestRegistrationCode':
          return this.client.request(
            'master/registration/send',
            'POST',
            this.controller.signal,
            account[operation].output,
            data,
          )
        case 'account.verifyRegistrationCode':
          return this.client.request(
            'master/registration/verify',
            'POST',
            this.controller.signal,
            account[operation].output,
            data,
          )
        case 'account.recoveryAvailable': {
          const { email } = account[operation].input.parse(input)
          const session = await this.storage.session(this.workspace)
          return Boolean(
            session?.cachedSyncKey &&
            session.masterKeys &&
            session.user.email.toLowerCase() === email.trim().toLowerCase(),
          )
        }
        case 'account.requestPasswordReset': {
          const { email } = account[operation].input.parse(input)
          await this.recoverable(email)
          return this.client.request(
            'master/recovery/send',
            'POST',
            this.controller.signal,
            account[operation].output,
            { email },
          )
        }
        case 'account.changePassword':
        case 'account.resetPassword': {
          const reset =
            operation === 'account.resetPassword' ? account[operation].input.parse(input) : undefined
          const change =
            operation === 'account.changePassword' ? account[operation].input.parse(input) : undefined
          const current = reset ? await this.recoverable(reset.email) : await this.current()
          if (!current.masterKeys || !current.cachedSyncKey)
            fail('DEVICE_RECOVERY_REQUIRED', '需要本机已解锁的数据密钥')
          const key = Buffer.from(current.cachedSyncKey.key, 'hex')
          let created: Created | undefined
          try {
            const latest = await this.client.request(
              'master/parameters',
              'POST',
              this.controller.signal,
              masterParametersSchema,
              { email: current.user.email },
            )
            if (latest.cryptoId !== current.masterKeys.cryptoId || latest.revision === undefined)
              fail('ACCOUNT_PROTOCOL', '账号加密身份已变化，原本地数据已保留')
            const parameters = {
              cryptoId: current.masterKeys.cryptoId,
              salt: randomBytes(16).toString('base64'),
            }
            created = await this.crypto<Created>('create', {
              password: reset?.newPassword ?? change!.newPassword,
              parameters,
              keys: { ...current.masterKeys, revision: latest.revision },
              key: Buffer.from(key),
            })
            if (reset)
              await this.client.request('master/recovery/reset', 'POST', this.controller.signal, undefined, {
                email: reset.email,
                code: reset.code,
                recoveryCredential: recoveryCredential(key, current.masterKeys.cryptoId),
                newCredential: created.credential,
                keys: created.keys,
              })
            else {
              const old = await this.crypto<{ credential: string }>('credential', {
                password: change!.password,
                parameters: { cryptoId: current.masterKeys.cryptoId, salt: current.masterKeys.salt },
              })
              await this.authorized('master/change', 'POST', undefined, {
                credential: old.credential,
                newCredential: created.credential,
                keys: created.keys,
              })
            }
            // Keep DEK for local recovery, invalidate session and require the new password for authentication.
            await this.storage.save(this.workspace, {
              ...current,
              tokens: null,
              masterKeys: { ...created.keys, revision: created.keys.revision + 1 },
              cachedSyncKey: { ...current.cachedSyncKey, revision: created.keys.revision + 1 },
            })
            await this.publish()
          } finally {
            key.fill(0)
            created?.key.fill(0)
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
