import { randomUUID } from 'node:crypto'
import { syncKeyEnvelopeSchema, syncPushSchema } from '@eizhu/contracts'
import type { Transport } from '../archive/network.ts'
import type { WireItem } from './model.ts'
import type { z } from 'zod'

/** Independent synthetic protocol peer used only by isolated acceptance tests. No production data. */
export class SyncFixture {
  seq = 0
  epoch = 1
  envelope?: z.infer<typeof syncKeyEnvelopeSchema>
  items = new Map<string, WireItem>()
  requests = new Map<string, { body: string; batch: unknown }>()
  batches: Array<{ seq: number; epoch: number; requestId: string; deviceId: string; items: WireItem[] }> = []
  snapshots = new Map<string, { items: WireItem[]; seq: number; epoch: number }>()
  counters: Record<string, number> = {}
  pushBodies: string[] = []
  pageSize = 100
  snapshotPageSize = 200
  expiredBefore = 0
  offline = false
  dropNextPush = false
  dropBeforePush = false
  denyCode = ''
  holdPush?: () => Promise<void>
  notify: () => void = () => undefined
  async handle(
    path: string,
    method: string,
    body: unknown,
    raw: string,
  ): Promise<{ status: number; value?: unknown; drop?: boolean }> {
    const url = new URL(path, 'https://synthetic.invalid'),
      route = url.pathname.replace('/api/sync/v2/', '')
    this.counters[route] = (this.counters[route] ?? 0) + 1
    const error = (status: number, code: string) => ({
      status,
      value: { code, message: 'SYNTHETIC-RAW-ERROR-MUST-NOT-LEAK' },
    })
    if (this.denyCode) return error(this.denyCode === 'RATE_LIMITED' ? 429 : 403, this.denyCode)
    if (route === 'capabilities')
      return {
        status: 200,
        value: { protocol: 2, seq: this.seq, epoch: this.epoch, keysReady: Boolean(this.envelope) },
      }
    if (route === 'devices') return { status: 200, value: body }
    if (route === 'keys') {
      if (method === 'GET')
        return this.envelope ? { status: 200, value: this.envelope } : error(404, 'KEY_NOT_FOUND')
      const next = syncKeyEnvelopeSchema.parse(body)
      if (next.revision !== (this.envelope?.revision ?? 0)) return error(409, 'KEY_CONFLICT')
      this.envelope = { ...next, revision: next.revision + 1 }
      return { status: 200, value: this.envelope }
    }
    if (route === 'snapshots' && method === 'POST') {
      const snapshotId = randomUUID(),
        snapshot = {
          items: [...this.items.values()].map((v) => structuredClone(v)),
          seq: this.seq,
          epoch: this.epoch,
        }
      this.snapshots.set(snapshotId, snapshot)
      return {
        status: 200,
        value: { snapshotId, seq: this.seq, epoch: this.epoch, count: snapshot.items.length },
      }
    }
    if (route.startsWith('snapshots/')) {
      const snapshot = this.snapshots.get(route.slice(10))
      if (!snapshot) return error(404, 'SNAPSHOT_EXPIRED')
      const offset = Number(url.searchParams.get('offset') ?? 0),
        end = Math.min(offset + this.snapshotPageSize, snapshot.items.length)
      return {
        status: 200,
        value: {
          items: snapshot.items.slice(offset, end),
          offset: end,
          hasMore: end < snapshot.items.length,
        },
      }
    }
    if (route === 'changes') {
      const after = Number(url.searchParams.get('after') ?? 0),
        upper = Math.min(Number(url.searchParams.get('until')) || this.seq, this.seq)
      if (after < this.expiredBefore) return error(409, 'CURSOR_EXPIRED')
      const batches = this.batches.filter((v) => v.seq > after && v.seq <= upper).slice(0, this.pageSize),
        cursor = batches.at(-1)?.seq ?? upper
      return { status: 200, value: { batches, cursor, until: upper, hasMore: cursor < upper } }
    }
    if (route.startsWith('requests/')) {
      const previous = this.requests.get(route.slice(9))
      return previous ? { status: 200, value: previous.batch } : error(404, 'REQUEST_NOT_FOUND')
    }
    if (route === 'push') {
      this.pushBodies.push(raw)
      if (this.dropBeforePush) {
        this.dropBeforePush = false
        return { status: 0, drop: true }
      }
      const push = syncPushSchema.parse(body),
        previous = this.requests.get(push.requestId)
      if (previous)
        return raw === previous.body ? { status: 200, value: previous.batch } : error(409, 'REQUEST_REUSED')
      if (!this.envelope) return error(409, 'KEY_REQUIRED')
      if (push.epoch !== this.epoch) return error(409, 'EPOCH_CHANGED')
      if (push.expectedSeq !== null && push.expectedSeq !== this.seq) return error(409, 'WATERMARK_CHANGED')
      if (
        push.replace &&
        [...this.items.keys()].some((id) => !push.items.some((i) => `${i.itemType}:${i.itemId}` === id))
      )
        return error(409, 'INVALID_REPLACEMENT')
      if (
        push.items.some(
          (i) => (this.items.get(`${i.itemType}:${i.itemId}`)?.revision ?? 0) !== i.baseRevision,
        )
      )
        return error(409, 'ITEM_CONFLICT')
      this.seq++
      if (push.replace) this.epoch++
      const items = push.items.map(({ epoch: _, ...item }) => {
        void _
        return item
      })
      const batch = {
        requestId: push.requestId,
        deviceId: push.deviceId,
        seq: this.seq,
        epoch: this.epoch,
        items,
      }
      for (const item of items)
        this.items.set(`${item.itemType}:${item.itemId}`, { ...item, epoch: this.epoch })
      this.requests.set(push.requestId, { body: raw, batch })
      this.batches.push(batch)
      this.notify()
      await this.holdPush?.()
      if (this.dropNextPush) {
        this.dropNextPush = false
        return { status: 0, drop: true }
      }
      return { status: 200, value: batch }
    }
    return error(404, 'NOT_FOUND')
  }
  transport: Transport = async (request, signal) => {
    if (this.offline || signal.aborted) throw new Error('Synthetic offline')
    const raw = request.body ? Buffer.from(request.body).toString('utf8') : ''
    const result = await this.handle(
      new URL(request.url).pathname + new URL(request.url).search,
      request.method,
      raw ? JSON.parse(raw) : undefined,
      raw,
    )
    if (result.drop) throw new Error('Synthetic response lost')
    return {
      status: result.status,
      headers: { 'content-type': 'application/json', 'retry-after': '1' },
      body: Buffer.from(JSON.stringify(result.value ?? null)),
    }
  }
}
