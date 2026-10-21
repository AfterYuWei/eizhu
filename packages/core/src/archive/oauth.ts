import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { fail } from '@eizhu/contracts'
import type { WorkerClient } from '../workers/client.ts'
import type { Provider, Token } from './repository.ts'
import { jsonBody, successful } from './network.ts'
import type { Transport } from './network.ts'
const tokenResponse = z.object({
  access_token: z.string().min(1).max(16384),
  refresh_token: z.string().max(16384).optional(),
  expires_in: z.number().int().min(1).max(31536000),
})
const endpoints = (type: string) =>
  type === 'gdrive'
    ? {
        auth: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        scope: 'https://www.googleapis.com/auth/drive.file',
      }
    : {
        auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        scope: 'Files.ReadWrite offline_access',
      }
/** The only local HTTP listener is an ephemeral OAuth callback; no desktop business gateway exists. */
export class OAuthManager {
  private database: WorkerClient
  private network: Transport
  private signal: AbortSignal
  private active = new Map<string, { server: Server; timer: NodeJS.Timeout }>()
  private refreshing = new Map<string, Promise<string>>()
  constructor(database: WorkerClient, network: Transport, signal: AbortSignal) {
    this.database = database
    this.network = network
    this.signal = signal
  }
  async begin(row: Provider): Promise<{ url: string }> {
    this.cancel(row.meta.id)
    if (this.active.size >= 4) fail('QUEUE_FULL', '同时最多发起 4 个授权')
    const state = randomBytes(32).toString('base64url'),
      verifier = randomBytes(32).toString('base64url'),
      path = '/oauth/' + row.config.type
    const api = endpoints(row.config.type),
      server = createServer()
    let used = false
    server.maxConnections = 4
    server.requestTimeout = 5000
    server.headersTimeout = 5000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') fail('OAUTH_FAILED', '无法创建授权回调')
    const redirect = `http://127.0.0.1:${address.port}${path}`
    server.on('error', () => this.cancel(row.meta.id))
    server.on('request', (request, response) => {
      let url: URL
      try {
        url = new URL(request.url || '/', redirect)
      } catch {
        response.writeHead(400).end('Invalid callback')
        return
      }
      if (
        used ||
        request.method !== 'GET' ||
        url.pathname !== path ||
        request.headers.host !== `127.0.0.1:${address.port}` ||
        url.searchParams.getAll('state').length !== 1 ||
        url.searchParams.get('state') !== state
      ) {
        response.writeHead(400).end('授权回调无效')
        return
      }
      used = true
      const finish = (success: boolean) => {
        response
          .writeHead(success ? 200 : 400, {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
            'content-security-policy': "default-src 'none'",
          })
          .end(success ? '授权完成，请返回 eizhu。' : '授权失败或目标已变化，请返回 eizhu 重新授权。')
        this.cancel(row.meta.id)
      }
      const code = url.searchParams.get('code')
      if (
        !code ||
        code.length > 8192 ||
        url.searchParams.getAll('code').length !== 1 ||
        url.searchParams.has('error')
      ) {
        finish(false)
        return
      }
      void (async () => {
        const current = await this.database.call<Provider>('archive.provider', { id: row.meta.id })
        if (current.revision !== row.revision) fail('TARGET_CHANGED', '目标已变化')
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: row.config.oauth_client_id!,
          redirect_uri: redirect,
          code_verifier: verifier,
        })
        if (row.config.oauth_client_secret) body.set('client_secret', row.config.oauth_client_secret)
        const token = await this.exchange(api.token, body)
        if (!token.refresh) fail('OAUTH_FAILED', '未取得离线授权，请重新授权')
        if (this.active.get(row.meta.id)?.server !== server) fail('OAUTH_FAILED', '授权已取消')
        await this.database.call('archive.token', { id: row.meta.id, revision: row.revision, token })
      })().then(
        () => finish(true),
        () => finish(false),
      )
    })
    const timer = setTimeout(() => this.cancel(row.meta.id), 5 * 60 * 1000)
    timer.unref()
    this.active.set(row.meta.id, { server, timer })
    const url = new URL(api.auth)
    url.search = new URLSearchParams({
      client_id: row.config.oauth_client_id!,
      redirect_uri: redirect,
      response_type: 'code',
      state,
      scope: api.scope,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      ...(row.config.type === 'gdrive' ? { access_type: 'offline', prompt: 'consent' } : {}),
    }).toString()
    return { url: url.href }
  }
  private async exchange(url: string, body: URLSearchParams, previous?: Token): Promise<Token> {
    const result = await this.network(
      {
        url,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: Buffer.from(body.toString()),
      },
      this.signal,
    )
    const parsed = tokenResponse.safeParse(jsonBody(successful(result)))
    if (!parsed.success) fail('OAUTH_FAILED', '授权令牌格式无效，请重新授权')
    return {
      access: parsed.data.access_token,
      refresh: parsed.data.refresh_token || previous?.refresh || '',
      expires: Date.now() + parsed.data.expires_in * 1000,
    }
  }
  async access(row: Provider): Promise<string> {
    if (row.token && row.token.expires > Date.now() + 60000) return row.token.access
    let work = this.refreshing.get(row.meta.id)
    if (!work) {
      work = this.refresh(row).finally(() => this.refreshing.delete(row.meta.id))
      this.refreshing.set(row.meta.id, work)
    }
    return work
  }
  private async refresh(row: Provider): Promise<string> {
    const current = await this.database.call<Provider>('archive.provider', { id: row.meta.id })
    if (current.revision !== row.revision) fail('TARGET_CHANGED', '目标已变化')
    if (current.token && current.token.expires > Date.now() + 60000) return current.token.access
    if (!current.token?.refresh) fail('CLOUD_AUTH_REQUIRED', '请先完成云存储授权')
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.token.refresh,
      client_id: current.config.oauth_client_id!,
    })
    if (current.config.oauth_client_secret) body.set('client_secret', current.config.oauth_client_secret)
    const token = await this.exchange(endpoints(current.config.type).token, body, current.token)
    await this.database.call('archive.token', { id: row.meta.id, revision: row.revision, token })
    return token.access
  }
  cancel(id: string): void {
    const p = this.active.get(id)
    if (p) {
      clearTimeout(p.timer)
      p.server.close()
      p.server.closeAllConnections()
      this.active.delete(id)
    }
  }
  close(): void {
    for (const id of this.active.keys()) this.cancel(id)
  }
}
