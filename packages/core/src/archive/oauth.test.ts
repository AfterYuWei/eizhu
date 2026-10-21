import test from 'node:test'
import assert from 'node:assert/strict'
import { OAuthManager } from './oauth.ts'
import type { Provider } from './repository.ts'
import type { WorkerClient } from '../workers/client.ts'
import type { Transport } from './network.ts'
function fixture() {
  const row: Provider = {
    meta: {
      id: '00000000-0000-4000-8000-000000000002',
      name: '测试 Drive',
      type: 'gdrive',
      enabled: true,
      created_at: '',
      updated_at: '',
    },
    revision: 1,
    config: { type: 'gdrive', name: '测试 Drive', enabled: true, oauth_client_id: 'desktop-client' },
  }
  const writes: unknown[] = []
  const db = {
    call: async (op: string, input: unknown) => {
      if (op === 'archive.provider') return row
      if (op === 'archive.token') {
        writes.push(input)
        return
      }
      assert.fail(op)
    },
  } as unknown as WorkerClient
  return { row, writes, db }
}
test('desktop OAuth binds single-use state, PKCE, loopback path and provider revision', async () => {
  const f = fixture()
  let exchanges = 0
  const network: Transport = async (request) => {
    exchanges++
    assert.equal(request.url, 'https://oauth2.googleapis.com/token')
    const form = new URLSearchParams(Buffer.from(request.body!).toString())
    assert.equal(form.get('code_verifier')?.length, 43)
    assert.match(form.get('redirect_uri')!, /^http:\/\/127\.0\.0\.1:\d+\/oauth\//)
    return {
      status: 200,
      headers: {},
      body: Buffer.from(
        JSON.stringify({
          access_token: 'synthetic-access',
          refresh_token: 'synthetic-refresh',
          expires_in: 3600,
        }),
      ),
    }
  }
  const manager = new OAuthManager(f.db, network, new AbortController().signal)
  try {
    const auth = new URL((await manager.begin(f.row)).url),
      callback = new URL(auth.searchParams.get('redirect_uri')!)
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(auth.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file')
    callback.search = new URLSearchParams({ state: 'wrong', code: 'synthetic-code' }).toString()
    assert.equal((await fetch(callback)).status, 400)
    assert.equal(exchanges, 0)
    callback.searchParams.set('state', auth.searchParams.get('state')!)
    assert.equal((await fetch(callback)).status, 200)
    assert.equal(exchanges, 1)
    assert.equal(f.writes.length, 1)
    await assert.rejects(fetch(callback))
  } finally {
    manager.close()
  }
})
test('editing a target invalidates its outstanding OAuth callback before token exchange', async () => {
  const f = fixture(),
    manager = new OAuthManager(
      f.db,
      async () => assert.fail('Cannot exchange for old target'),
      new AbortController().signal,
    )
  try {
    const auth = new URL((await manager.begin(structuredClone(f.row))).url),
      callback = new URL(auth.searchParams.get('redirect_uri')!)
    f.row.revision++
    callback.search = new URLSearchParams({
      state: auth.searchParams.get('state')!,
      code: 'old-code',
    }).toString()
    assert.equal((await fetch(callback)).status, 400)
    assert.equal(f.writes.length, 0)
  } finally {
    manager.close()
  }
})
