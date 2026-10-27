import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncHttpRequestSchema, syncCapabilitiesSchema, DesktopError } from '@eizhu/contracts'
import { SseHints } from './sse.ts'
import { fromPortable, portable, equal } from './model.ts'
import { payloadSchema } from '../local/model.ts'
import { readFile } from 'node:fs/promises'

test('SSE split UTF-8/CRLF only wakes for complete ready/change; bounded and safe integers', () => {
  let wakes = 0
  const parser = new SseHints(() => wakes++),
    bytes = Buffer.from(
      ': 心跳\r\nevent: ready\r\ndata: {"seq":4}\r\n\r\nevent: heartbeat\ndata: {}\n\nevent: change\ndata: {"seq":5}\n\n',
    )
  for (const byte of bytes) parser.feed(Uint8Array.of(byte))
  assert.equal(wakes, 2)
  assert.throws(
    () => parser.feed(Buffer.from('event: change\ndata: {"seq":9007199254740992}\n\n')),
    (e) => e instanceof DesktopError && e.error.code === 'SYNC_PROTOCOL',
  )
  assert.throws(() => new SseHints(() => undefined).feed(Buffer.alloc(65537)))
  const bounded = new SseHints(() => undefined)
  assert.throws(() => {
    for (let i = 0; i < 700; i++) bounded.feed(Buffer.from('data: ' + 'x'.repeat(100) + '\n'))
  })
})
test('finite sync routes reject foreign origin, duplicate/query overflow and setup writes', () => {
  const base = {
    url: 'https://eizhu.yuweinfo.com/api/sync/v2/changes?after=0&until=4',
    method: 'GET',
    headers: { accept: 'application/json', authorization: 'Bearer synthetic' },
  }
  assert.equal(syncHttpRequestSchema.safeParse(base).success, true)
  for (const url of [
    'http://eizhu.yuweinfo.com/api/sync/v2/keys',
    'https://evil.invalid/api/sync/v2/keys',
    'https://eizhu.yuweinfo.com/api/auth/setup',
    'https://eizhu.yuweinfo.com/api/sync/v2/events',
    'https://eizhu.yuweinfo.com/api/sync/v2/changes?after=9007199254740992',
    'https://eizhu.yuweinfo.com/api/sync/v2/changes?after=0&after=1',
  ])
    assert.equal(syncHttpRequestSchema.safeParse({ ...base, url }).success, false)
  assert.equal(
    syncCapabilitiesSchema.safeParse({ protocol: 2, seq: 9007199254740992, epoch: 1, keysReady: false })
      .success,
    false,
  )
})
test('portable rows round-trip frozen backup credentials, private keys, proxy and snippets', async () => {
  const p = payloadSchema.parse(
    JSON.parse(await readFile('tests/fixtures/desktop-baseline/payload-plain.json', 'utf8')),
  )
  const kinds = { group: p.groups, vault: p.vault, profile: p.profiles, snippet: p.snippets } as const
  for (const [type, rows] of Object.entries(kinds))
    for (const row of rows)
      assert.equal(
        equal(
          row,
          fromPortable(type as keyof typeof kinds, row.id, portable(type as keyof typeof kinds, row)),
        ),
        true,
      )
})

test('notification relay allows one unacknowledged chunk, rejects wrong credit and cancels promptly', async () => {
  const { SyncEventRelay } = await import('./relay.ts')
  const messages: Array<{ type: string; id: string; sequence?: number }> = []
  let reads = 0
  const relay = new SyncEventRelay(
    (message) => messages.push(message as (typeof messages)[number]),
    async (_authorization, signal, consume) => {
      for (let i = 0; i < 3 && !signal.aborted; i++) {
        reads++
        await consume(Buffer.from('data: {}\n\n'))
      }
    },
  )
  relay.open('one', { authorization: 'Bearer synthetic' })
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(reads, 1)
  relay.acknowledge('one', 99)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(reads, 1)
  relay.acknowledge('one', 1)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(reads, 2)
  relay.open('two', { authorization: 'Bearer synthetic' })
  assert.ok(messages.find((m) => m.type === 'sync.events.end' && m.id === 'two'))
  await relay.close()
  assert.equal(reads, 2)
})

test('malformed remote options remain inspectable as a safe dependency conflict', async () => {
  const { summary } = await import('./model.ts')
  const profile = fromPortable('profile', 'invalid-options', {
    id: 'invalid-options',
    name: '待处理关联',
    host: 'synthetic.invalid',
    port: 22,
    username: 'root',
    auth_type: 'agent',
    tags: [],
    options: '{synthetic-sensitive-invalid-options',
    sort_order: 0,
  })
  const result = summary('profile', profile)
  assert.equal(result?.name, '待处理关联')
  assert.equal(Object.hasOwn(result!, 'options'), false)
  assert.equal(JSON.stringify(result).includes('synthetic-sensitive'), false)
})
