import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import {SyncFixture} from '@eizhu/core/sync/fixture'
import type {EventStream} from '@eizhu/core/sync/service'
import {readSyncEvents} from './sync-events.ts'
import type {ServerResponse} from 'node:http'
import { accountHttp } from './account-network.ts'
import type { Transport } from '@eizhu/core/archive/network'

type User = { id: number; email: string; password: string; emailVerified: boolean; disabled: boolean }
export interface AccountFixture {
  transport: Transport
  events: EventStream
  sync(userId:number):SyncFixture
  readonly subscribers:number
  emitHint(seq:number):void
  disconnectEvents():void
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
  const peers=new Map<number,SyncFixture>(),streams=new Map<ServerResponse,number>()
  const syncFor=(userId:number)=>{let peer=peers.get(userId);if(!peer){peer=new SyncFixture();peer.notify=()=>{for(const [res,id]of streams)if(id===userId)res.write(`event: change\ndata: ${JSON.stringify({seq:peer!.seq})}\n\n`)};peers.set(userId,peer)}return peer}
  const requests: Record<string, number> = {}
  const summary = (user: User) => ({
    id: user.id,
    email: user.email,
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
    return { accessToken: a, refreshToken: r, expiresIn: 1800, user: summary(user) }
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
      if (path === '/api/auth/register' || path === '/api/auth/login') {
        if (fixture.authDelayMs) await new Promise((resolve) => setTimeout(resolve, fixture.authDelayMs))
        if (path.endsWith('register') && fixture.denyRegister) return error(403, 'ACCESS_DENIED')
        let user = users.get(normalizedEmail)
        if (path.endsWith('register')) {
          if (user) return error(409, 'EMAIL_TAKEN')
          user = {
            id: users.size + 101,
            email: normalizedEmail,
            password: body.password,
            emailVerified: false,
            disabled: false,
          }
          users.set(normalizedEmail, user)
        } else if (!user || user.password !== body.password) return error(401, 'INVALID_CREDENTIALS')
        if (user.disabled) return error(403, 'ACCOUNT_DISABLED')
        const tokens = issue(user)
        if (fixture.dropNextAuth) {
          fixture.dropNextAuth = false
          res.destroy()
          return
        }
        return reply(200, tokens)
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
      if (path === '/api/auth/password/forgot') return reply(200)
      if (path === '/api/auth/password/reset') {
        const user = users.get(normalizedEmail)
        if (!user || body.code !== '654321') return error(400, 'INVALID_EMAIL_CODE')
        user.password = body.newPassword
        user.emailVerified = true
        for (const [key, value] of access) if (value.id === user.id) access.delete(key)
        for (const [key, value] of refresh) if (value.id === user.id) refresh.delete(key)
        return reply(200)
      }
      const user = access.get(req.headers.authorization?.replace(/^Bearer /, '') ?? '')
      if (!user) return error(401, 'UNAUTHENTICATED')
      if (user.disabled) return error(403, 'ACCOUNT_DISABLED')
      if(path.startsWith('/api/sync/v2/')){
        if(!user.emailVerified)return error(403,'EMAIL_NOT_VERIFIED')
        const peer=syncFor(user.id)
        if(path.endsWith('/events')){
          res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});streams.set(res,user.id);res.write(`event: ready\ndata: ${JSON.stringify({seq:peer.seq})}\n\n`)
          const heartbeat=setInterval(()=>res.write(': synthetic heartbeat\n\n'),1000);res.once('close',()=>{clearInterval(heartbeat);streams.delete(res)});return
        }
        const result=await peer.handle(req.url!,req.method!,body,raw.toString())
        if(result.drop){res.destroy();return}
        return reply(result.status,result.value)
      }
      if (path === '/api/auth/me') {
        if (fixture.rejectMeCount > 0) {
          fixture.rejectMeCount--
          return error(401, 'UNAUTHENTICATED')
        }
        return reply(200, { ...summary(user), role: 'USER' })
      }
      if (path === '/api/auth/email/send') return reply(200)
      if (path === '/api/auth/email/verify') {
        if (body.code !== '123456') return error(400, 'INVALID_EMAIL_CODE')
        user.emailVerified = true
        return reply(200)
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
    sync:syncFor,
    get subscribers(){return streams.size},
    emitHint:(seq)=>{for(const res of streams.keys())res.write(`event: change\ndata: ${JSON.stringify({seq})}\n\n`)},
    disconnectEvents:()=>{for(const res of streams.keys())res.end()},
    events:(authorization,signal,consume)=>fixture.offline?Promise.reject(new Error('Synthetic offline')):readSyncEvents(authorization,signal,consume,`http://127.0.0.1:${port}/api/sync/v2/events`),
    transport: (request, signal) => {
      if (fixture.offline) return Promise.reject(new Error('Synthetic offline'))
      const source = new URL(request.url)
      return accountHttp({ ...request, url: `http://127.0.0.1:${port}${source.pathname}${source.search}` }, signal)
    },
    close: () =>
      (closed ??= new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      })),
  }
  return fixture
}
