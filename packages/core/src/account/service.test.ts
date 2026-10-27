import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DesktopError, offlineWorkspace } from '@eizhu/contracts'
import type { AccountStatus, WorkspaceIdentity } from '@eizhu/contracts'
import type { AccountSession } from './repository.ts'
import type { AccountStorage } from './storage.ts'
import type { Transport } from '../archive/network.ts'
import { AccountService } from './service.ts'
import { accountWorkspace } from './workspace.ts'

const user = {
  id: 42,
  email: 'synthetic@example.invalid',
  storageUsed: 0,
  storageQuota: 1024,
  emailVerified: false,
  verificationRequired: true,
}
const response = (status: number, body?: unknown) => ({
  status,
  headers: {},
  body: new TextEncoder().encode(body === undefined ? '' : JSON.stringify(body)),
})
const session = (): AccountSession => ({
  user,
  syncEnabled: false,
  tokens: { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1 },
  cachedSyncKey: { key: '09'.repeat(32), revision: 1 },
})
const code = (expected: string) => (cause: unknown) =>
  cause instanceof DesktopError && cause.error.code === expected
function storage(identity: WorkspaceIdentity, initial?: AccountSession) {
  const rows = new Map<string, AccountSession>()
  if (initial) rows.set(identity.id, structuredClone(initial))
  const api: AccountStorage = {
    status: async (): Promise<AccountStatus> =>
      identity.id === 'offline'
        ? { loggedIn: false, sessionState: 'anonymous', syncEnabled: false }
        : {
            loggedIn: true,
            sessionState: rows.get(identity.id)?.tokens ? 'authenticated' : 'reauth_required',
            syncEnabled: false,
            user: rows.get(identity.id)!.user,
          },
    session: async (workspace) => {
      if (workspace.id === 'offline') return null
      if (!rows.has(workspace.id))
        throw new DesktopError({ code: 'ACCOUNT_NOT_FOUND', message: 'missing synthetic account' })
      return structuredClone(rows.get(workspace.id)!)
    },
    acceptLogin: async (workspace, user, tokens) => {
      const current=rows.get(workspace.id),next={...current,user,tokens,syncEnabled:current?.syncEnabled??false}
      rows.set(workspace.id,structuredClone(next));return structuredClone(next)
    },
    save: async (workspace, value) => {
      rows.set(workspace.id, structuredClone(value))
    },
    update: async (workspace, expected, patch) => {
      const current = rows.get(workspace.id)!
      if (!current.tokens || current.tokens.refreshToken !== expected)
        throw new DesktopError({ code: 'ACCOUNT_SESSION_CHANGED', message: 'changed' })
      const next = { ...current, ...patch }
      rows.set(workspace.id, structuredClone(next))
      return structuredClone(next)
    },
  }
  return { rows, api }
}

test('initialization blocks registration and lost authentication responses never replay writes', async () => {
  const store = storage(offlineWorkspace)
  let initialized = false,
    writes = 0
  const transport: Transport = async (request) => {
    if (request.url.endsWith('/setup'))
      return response(200, { required: !initialized, passwordMinLength: 16 })
    writes++
    throw new Error('synthetic lost response')
  }
  const service = new AccountService(store.api, transport, offlineWorkspace, () => {})
  try {
    await assert.rejects(
      service.authenticate('account.register', { email: user.email, password: 'password123' }),
      code('ACCOUNT_SETUP_REQUIRED'),
    )
    assert.equal(writes, 0)
    initialized = true
    await assert.rejects(
      service.authenticate('account.register', { email: user.email, password: 'password123' }),
      code('ACCOUNT_UNAVAILABLE'),
    )
    assert.equal(writes, 1)
    assert.equal(store.rows.size, 0)
  } finally {
    await service.close()
  }
})

test('concurrent expiry refreshes once, persists rotation and exposes only public account status', async () => {
  const identity = accountWorkspace(42),
    store = storage(identity, session())
  let refreshed = 0
  const service = new AccountService(
    store.api,
    async (request) => {
      if (request.url.endsWith('/refresh')) {
        refreshed++
        await new Promise((resolve) => setTimeout(resolve, 5))
        return response(200, {
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          expiresIn: 1800,
          user,
        })
      }
      assert.equal(request.headers.authorization, 'Bearer new-access')
      return response(200, { ...user, role: 'USER' })
    },
    identity,
    () => {},
  )
  try {
    await Promise.all([service.execute('account.me', undefined), service.execute('account.me', undefined)])
    assert.equal(refreshed, 1)
    assert.equal(store.rows.get(identity.id)?.tokens?.refreshToken, 'new-refresh')
    assert.ok(store.rows.get(identity.id)?.cachedSyncKey)
    assert.equal(
      JSON.stringify(await service.execute('account.status', undefined)).includes('new-refresh'),
      false,
    )
  } finally {
    await service.close()
  }
})

test('lost refresh response invalidates that session without clearing cached data keys or retrying', async () => {
  const identity = accountWorkspace(42),
    store = storage(identity, session()),
    statuses: AccountStatus[] = []
  let requests = 0
  const service = new AccountService(
    store.api,
    async () => {
      requests++
      throw new Error('synthetic lost refresh')
    },
    identity,
    (status) => statuses.push(status),
  )
  try {
    await assert.rejects(service.execute('account.me', undefined), code('ACCOUNT_UNAVAILABLE'))
    await assert.rejects(service.execute('account.me', undefined), code('ACCOUNT_NOT_LOGGED_IN'))
    assert.equal(requests, 1)
    assert.equal(store.rows.get(identity.id)?.tokens, null)
    assert.ok(store.rows.get(identity.id)?.cachedSyncKey)
    assert.equal(statuses.at(-1)?.sessionState, 'reauth_required')
  } finally {
    await service.close()
  }
})

test('a delayed unauthorized response reuses a completed refresh instead of rotating again', async () => {
  const identity = accountWorkspace(42), initial = session()
  initial.tokens!.expiresAt = Date.now() + 3600000
  const store = storage(identity, initial)
  const replies: Array<() => void> = []
  let arrived!: () => void, refreshed = 0
  const allArrived = new Promise<void>((resolve) => { arrived = resolve })
  const service = new AccountService(store.api, async (request) => {
    if (request.url.endsWith('/refresh')) {
      refreshed++
      return response(200, { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 1800, user })
    }
    if (request.headers.authorization === 'Bearer old-access') return new Promise((resolve) => {
      replies.push(() => resolve(response(401, { code: 'UNAUTHENTICATED' })))
      if (replies.length === 2) arrived()
    })
    return response(200, user)
  }, identity, () => {})
  try {
    const first = service.execute('account.me', undefined), second = service.execute('account.me', undefined)
    await allArrived
    replies[0](); await first
    replies[1](); await second
    assert.equal(refreshed, 1)
  } finally { await service.close() }
})

test('logout never refreshes expired credentials and leaves key deletion to the atomic space commit', async () => {
  const identity = accountWorkspace(42), store = storage(identity, session())
  const paths: string[] = []
  const service = new AccountService(store.api, async (request) => { paths.push(request.url); throw new Error('synthetic lost logout') }, identity, () => {})
  try {
    await service.prepareLogout()
    assert.equal(paths.length, 1)
    assert.ok(paths[0].endsWith('/logout'))
    assert.equal(store.rows.get(identity.id)?.tokens, null)
    assert.ok(store.rows.get(identity.id)?.cachedSyncKey)
  } finally { await service.close() }
})

test('closing cancels and waits for in-flight refresh without emitting a late account event', async () => {
  const identity = accountWorkspace(42), store = storage(identity, session()), statuses: AccountStatus[] = []
  let started!: () => void
  const ready = new Promise<void>((resolve) => { started = resolve })
  const service = new AccountService(store.api, async (_request, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('synthetic aborted')), { once: true }); started()
  }), identity, (status) => statuses.push(status))
  const rejected = assert.rejects(service.execute('account.me', undefined), code('CANCELLED'))
  await ready; await service.close(); await rejected
  assert.equal(statuses.length, 0)
  await assert.rejects(service.execute('account.me', undefined), code('RUNTIME_CLOSED'))
})

test('a late refresh cannot overwrite or invalidate a more recent successful login', async () => {
  const identity = accountWorkspace(42),
    store = storage(identity, session())
  const service = new AccountService(
    store.api,
    async () => {
      await store.api.save(identity, {
        ...session(),
        tokens: {
          accessToken: 'later-login-access',
          refreshToken: 'later-login-refresh',
          expiresAt: Date.now() + 3600000,
        },
      })
      return response(200, {
        accessToken: 'stale-access',
        refreshToken: 'stale-refresh',
        expiresIn: 1800,
        user,
      })
    },
    identity,
    () => {},
  )
  try {
    await assert.rejects(service.execute('account.me', undefined), code('ACCOUNT_SESSION_CHANGED'))
    assert.equal(store.rows.get(identity.id)?.tokens?.refreshToken, 'later-login-refresh')
  } finally {
    await service.close()
  }
})

test('wrong identity and raw server errors never replace the local account or expose response bodies', async () => {
  const identity = accountWorkspace(42),
    current = session(),
    store = storage(identity, { ...current, tokens: { ...current.tokens!, expiresAt: Date.now() + 3600000 } })
  let mode = 'wrong-user'
  const service = new AccountService(
    store.api,
    async () =>
      mode === 'wrong-user'
        ? response(200, { ...user, id: 43, role: 'USER' })
        : response(401, { code: 'INVALID_CREDENTIALS', message: 'SYNTHETIC-SECRET' }),
    identity,
    () => {},
  )
  try {
    await assert.rejects(service.execute('account.me', undefined), code('ACCOUNT_PROTOCOL'))
    assert.equal(store.rows.get(identity.id)?.user.id, 42)
    mode = 'bad-password'
    await assert.rejects(
      service.authenticate('account.login', { email: user.email, password: 'wrong' }),
      (cause: unknown) => !String(cause).includes('SYNTHETIC-SECRET'),
    )
  } finally {
    await service.close()
  }
})
