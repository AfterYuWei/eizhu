import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { account, masterKeyEnvelopeSchema, type syncKeyEnvelopeSchema } from '@eizhu/contracts'
import type { z } from 'zod'
import { SyncFixture } from '@eizhu/core/sync/fixture'
import type { EventStream } from '@eizhu/core/sync/service'
import { readSyncEvents } from './sync-events.ts'
import type { ServerResponse } from 'node:http'
import { accountHttp } from './account-network.ts'
import type { Transport } from '@eizhu/core/archive/network'

type User = {
  id: number
  email: string
  credential: string
  username?: string
  avatar?: string
  emailVerified: boolean
  disabled: boolean
  keys?: z.infer<typeof syncKeyEnvelopeSchema>
  recoveryHash?: string
}
export interface AccountFixture {
  transport: Transport
  events: EventStream
  sync(userId: number): SyncFixture
  readonly subscribers: number
  emitHint(seq: number): void
  disconnectEvents(): void
  setupRequired: boolean
  denyRegister: boolean
  offline: boolean
  rejectMeCount: number
  dropNextRefresh: boolean
  dropNextLogout: boolean
  dropNextAuth: boolean
  authDelayMs: number
  requests: Record<string, number>
  close(): Promise<void>
}

/** Local protocol simulator, created exclusively by the validated --smoke-test entry. No real mail/accounts. */
export async function createAccountFixture(): Promise<AccountFixture> {
  const users = new Map<string, User>(),
    access = new Map<string, User>(),
    refresh = new Map<string, User>()
  const peers = new Map<number, SyncFixture>(),
    streams = new Map<ServerResponse, number>()
  const syncFor = (userId: number) => {
    let peer = peers.get(userId)
    if (!peer) {
      peer = new SyncFixture()
      peer.notify = () => {
        for (const [res, id] of streams)
          if (id === userId) res.write(`event: change\ndata: ${JSON.stringify({ seq: peer!.seq })}\n\n`)
      }
      peers.set(userId, peer)
    }
    return peer
  }
  const registrations = new Map<string, { id: string; ticket?: string; attempts: number; expires: number }>()
  const requests: Record<string, number> = {}
  const summary = (user: User) => ({
    id: user.id,
    email: user.email,
    username: user.username || '',
    avatar: user.avatar || '',
    emailVerified: user.emailVerified,
    verificationRequired: true,
    storageUsed: 0,
    storageQuota: 1048576,
  })
  const issue = (user: User) => {
    const a = `synthetic-access-${randomUUID()}`,
      r = `synthetic-refresh-${randomUUID()}`
    access.set(a, user)
    refresh.set(r, user)
    const publicUser = {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      verificationRequired: true,
      storageUsed: 0,
      storageQuota: 1048576,
    }
    return { accessToken: a, refreshToken: r, expiresIn: 1800, user: publicUser }
  }
  let closed: Promise<void> | undefined
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://127.0.0.1').pathname
    requests[path] = (requests[path] ?? 0) + 1
    const reply = (status: number, value?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(value === undefined ? '' : JSON.stringify(value))
    }
    const error = (status: number, code: string) =>
      reply(status, { code, message: 'SYNTHETIC-RAW-ERROR-MUST-NOT-LEAK' })
    let raw: Buffer | undefined
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      raw = Buffer.concat(chunks)
      const body = raw.length ? (JSON.parse(raw.toString()) as Record<string, string>) : {}
      const normalizedEmail = body.email?.trim().toLowerCase()
      if (path === '/api/auth/setup')
        return reply(200, { required: fixture.setupRequired, passwordMinLength: 16 })
      if (path === '/api/auth/master/registration/send') {
        if (fixture.setupRequired) return error(409, 'ACCOUNT_SETUP_REQUIRED')
        const challengeId = randomUUID(),
          expires = Date.now() + 600000
        registrations.set(normalizedEmail, { id: challengeId, attempts: 0, expires })
        return reply(200, { challengeId, retryAfterSeconds: 60, expiresAt: new Date(expires).toISOString() })
      }
      if (path === '/api/auth/master/registration/verify') {
        const challenge = registrations.get(normalizedEmail)
        if (
          !challenge ||
          challenge.id !== body.challengeId ||
          challenge.ticket ||
          challenge.expires < Date.now() ||
          challenge.attempts++ >= 5 ||
          body.code !== '123456'
        )
          return error(400, 'INVALID_EMAIL_CODE')
        challenge.ticket = randomUUID() + randomUUID()
        return reply(200, { ticket: challenge.ticket })
      }
      if (path === '/api/auth/master/parameters') {
        const user = users.get(normalizedEmail)
        if (!user?.keys || user.keys.version !== 2) return error(401, 'INVALID_CREDENTIALS')
        return reply(200, {
          cryptoId: user.keys.cryptoId,
          salt: user.keys.salt,
          revision: user.keys.revision,
        })
      }
      if (path === '/api/auth/master/register' || path === '/api/auth/master/login') {
        if (fixture.authDelayMs) await new Promise((resolve) => setTimeout(resolve, fixture.authDelayMs))
        if (path.endsWith('/register') && fixture.denyRegister) return error(403, 'ACCESS_DENIED')
        let user = users.get(normalizedEmail)
        if (path.endsWith('/register')) {
          const challenge = registrations.get(normalizedEmail)
          if (!challenge?.ticket || challenge.ticket !== body.ticket || challenge.expires < Date.now())
            return error(400, 'INVALID_EMAIL_CODE')
          if (user) return error(409, 'EMAIL_TAKEN')
          const keys = masterKeyEnvelopeSchema.parse(body.keys)
          user = {
            id: users.size + 101,
            email: normalizedEmail,
            credential: body.credential,
            emailVerified: true,
            disabled: false,
            keys: { ...keys, revision: 1 },
            recoveryHash: body.recoveryHash,
          }
          users.set(normalizedEmail, user)
          registrations.delete(normalizedEmail)
          syncFor(user.id).envelope = user.keys
        } else if (!user || user.credential !== body.credential) return error(401, 'INVALID_CREDENTIALS')
        const tokens = issue(user)
        if (fixture.dropNextAuth) {
          fixture.dropNextAuth = false
          res.destroy()
          return
        }
        return reply(200, { tokens, keys: user.keys })
      }
      if (path === '/api/auth/master/recovery/send') return reply(200, { retryAfterSeconds: 60 })
      if (path === '/api/auth/master/recovery/reset') {
        const user = users.get(normalizedEmail),
          keys = masterKeyEnvelopeSchema.parse(body.keys)
        if (!user || body.code !== '654321') return error(400, 'INVALID_EMAIL_CODE')
        if (createHash('sha256').update(body.recoveryCredential).digest('hex') !== user.recoveryHash)
          return error(403, 'DEVICE_RECOVERY_REQUIRED')
        if (keys.revision !== user.keys?.revision) return error(409, 'KEY_CONFLICT')
        user.credential = body.newCredential
        user.keys = { ...keys, revision: keys.revision + 1 }
        syncFor(user.id).envelope = user.keys
        for (const [key, value] of access) if (value.id === user.id) access.delete(key)
        for (const [key, value] of refresh) if (value.id === user.id) refresh.delete(key)
        return reply(200)
      }
      if (path === '/api/auth/refresh') {
        const user = refresh.get(body.refreshToken)
        if (!user) return error(401, 'INVALID_REFRESH_TOKEN')
        refresh.delete(body.refreshToken)
        const tokens = issue(user)
        await new Promise((resolve) => setTimeout(resolve, 60))
        if (fixture.dropNextRefresh) {
          fixture.dropNextRefresh = false
          res.destroy()
          return
        }
        return reply(200, tokens)
      }
      const user = access.get(req.headers.authorization?.replace(/^Bearer /, '') ?? '')
      if (!user) return error(401, 'UNAUTHENTICATED')
      if (user.disabled) return error(403, 'ACCOUNT_DISABLED')
      if (path === '/api/auth/master/change') {
        const keys = masterKeyEnvelopeSchema.parse(body.keys)
        if (user.credential !== body.credential) return error(401, 'INVALID_CREDENTIALS')
        if (keys.revision !== user.keys?.revision) return error(409, 'KEY_CONFLICT')
        user.credential = body.newCredential
        user.keys = { ...keys, revision: keys.revision + 1 }
        syncFor(user.id).envelope = user.keys
        for (const [key, value] of access) if (value.id === user.id) access.delete(key)
        for (const [key, value] of refresh) if (value.id === user.id) refresh.delete(key)
        return reply(200)
      }
      if (path.startsWith('/api/sync/v2/')) {
        if (!user.emailVerified) return error(403, 'EMAIL_NOT_VERIFIED')
        const peer = syncFor(user.id)
        if (path.endsWith('/events')) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
          streams.set(res, user.id)
          res.write(`event: ready\ndata: ${JSON.stringify({ seq: peer.seq })}\n\n`)
          const heartbeat = setInterval(() => res.write(': synthetic heartbeat\n\n'), 1000)
          res.once('close', () => {
            clearInterval(heartbeat)
            streams.delete(res)
          })
          return
        }
        const result = await peer.handle(req.url!, req.method!, body, raw.toString())
        if (result.drop) {
          res.destroy()
          return
        }
        return reply(result.status, result.value)
      }
      if (path === '/api/auth/profile') {
        const profile = account['account.updateProfile'].input.parse(body)
        user.username = profile.username
        user.avatar = profile.avatar
        return reply(200, { ...summary(user), role: 'USER' })
      }
      if (path === '/api/auth/me') {
        if (fixture.rejectMeCount > 0) {
          fixture.rejectMeCount--
          return error(401, 'UNAUTHENTICATED')
        }
        return reply(200, { ...summary(user), role: 'USER' })
      }
      if (path === '/api/auth/logout') {
        refresh.delete(body.refreshToken)
        if (fixture.dropNextLogout) {
          fixture.dropNextLogout = false
          res.destroy()
          return
        }
        return reply(200)
      }
      return error(404, 'NOT_FOUND')
    } catch {
      if (!res.destroyed) error(400, 'VALIDATION_FAILED')
    } finally {
      raw?.fill(0)
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const port = (server.address() as { port: number }).port
  const fixture: AccountFixture = {
    setupRequired: false,
    denyRegister: false,
    offline: false,
    rejectMeCount: 0,
    dropNextRefresh: false,
    dropNextLogout: false,
    dropNextAuth: false,
    authDelayMs: 0,
    requests,
    sync: syncFor,
    get subscribers() {
      return streams.size
    },
    emitHint: (seq) => {
      for (const res of streams.keys()) res.write(`event: change\ndata: ${JSON.stringify({ seq })}\n\n`)
    },
    disconnectEvents: () => {
      for (const res of streams.keys()) res.end()
    },
    events: (authorization, signal, consume) =>
      fixture.offline
        ? Promise.reject(new Error('Synthetic offline'))
        : readSyncEvents(authorization, signal, consume, `http://127.0.0.1:${port}/api/sync/v2/events`),
    transport: (request, signal) => {
      if (fixture.offline) return Promise.reject(new Error('Synthetic offline'))
      const source = new URL(request.url)
      return accountHttp(
        { ...request, url: `http://127.0.0.1:${port}${source.pathname}${source.search}` },
        signal,
      )
    },
    close: () =>
      (closed ??= new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      })),
  }
  return fixture
}
