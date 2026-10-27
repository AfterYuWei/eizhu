import { z } from 'zod'
import { syncItemTypeSchema } from './sync.ts'

const integer = z.int().nonnegative()
export const syncCapabilitiesSchema = z.strictObject({
  protocol: z.literal(2),
  seq: integer,
  epoch: z.int().positive(),
  keysReady: z.boolean(),
})
export const syncKeyEnvelopeSchema = z.strictObject({
  salt: z.string().min(1).max(64),
  time: z.int().min(1).max(100),
  memory: z.int().min(8192).max(1048576),
  threads: z.int().min(1).max(16),
  wrappedKey: z.string().min(1).max(256),
  version: z.literal(1),
  revision: integer,
})
export const syncWireItemSchema = z.strictObject({
  itemType: syncItemTypeSchema,
  itemId: z.string().min(1).max(200),
  baseRevision: integer,
  revision: z.int().positive(),
  generation: integer,
  deleted: z.boolean(),
  payload: z.string().min(1).max(2097152),
  keyVersion: z.literal(1),
  epoch: z.int().positive().nullable().optional(),
})
export const syncPushSchema = z
  .strictObject({
    requestId: z.uuid(),
    deviceId: z.uuid(),
    epoch: z.int().positive(),
    replace: z.boolean(),
    expectedSeq: integer.nullable(),
    items: z.array(syncWireItemSchema).max(10000),
  })
  .superRefine((push, ctx) => {
    const seen = new Set<string>()
    for (const item of push.items) {
      const identity = `${item.itemType}:${item.itemId}`
      if (seen.has(identity) || item.revision !== item.baseRevision + 1)
        ctx.addIssue({ code: 'custom', message: '条目重复或修订号无效' })
      seen.add(identity)
    }
    if (push.replace && push.expectedSeq === null)
      ctx.addIssue({ code: 'custom', message: '整体替换必须绑定云端水位' })
  })
export const syncBatchSchema = z.strictObject({
  requestId: z.uuid(),
  deviceId: z.uuid().optional(),
  seq: z.int().positive(),
  epoch: z.int().positive(),
  items: z.array(syncWireItemSchema).max(10000),
})
export const syncChangesSchema = z.strictObject({
  batches: z.array(syncBatchSchema).max(100),
  cursor: integer,
  until: integer,
  hasMore: z.boolean(),
})
export const syncSnapshotSchema = z.strictObject({
  snapshotId: z.uuid(),
  seq: integer,
  epoch: z.int().positive(),
  count: integer,
})
export const syncSnapshotPageSchema = z.strictObject({
  items: z.array(syncWireItemSchema).max(200),
  offset: integer,
  hasMore: z.boolean(),
})

/** Internal fixed-origin finite sync transport. SSE has its own flow-controlled channel. */
export const syncHttpRequestSchema = z
  .strictObject({
    url: z.url().max(768),
    method: z.enum(['GET', 'POST', 'PUT']),
    headers: z.strictObject({
      accept: z.literal('application/json'),
      'content-type': z.literal('application/json').optional(),
      authorization: z
        .string()
        .regex(/^Bearer [^\r\n]+$/)
        .max(32775),
    }),
    body: z
      .instanceof(Uint8Array)
      .refine((v) => v.byteLength <= 50 * 1024 * 1024)
      .optional(),
  })
  .superRefine((request, ctx) => {
    const url = new URL(request.url),
      base = '/api/sync/v2/',
      route = url.pathname.slice(base.length)
    const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
    const allowed =
      request.method === 'GET'
        ? ['capabilities', 'keys', 'changes'].includes(route) ||
          new RegExp(`^(snapshots|requests)/${uuid}$`).test(route)
        : request.method === 'PUT'
          ? route === 'keys'
          : ['devices', 'snapshots', 'push'].includes(route)
    const params = [...url.searchParams]
    const query =
      route === 'changes'
        ? params.every(
            ([k, v]) =>
              ['after', 'until'].includes(k) &&
              /^(0|[1-9][0-9]*)$/.test(v) &&
              Number.isSafeInteger(Number(v)),
          )
        : route.startsWith('snapshots/')
          ? params.every(
              ([k, v]) => k === 'offset' && /^(0|[1-9][0-9]*)$/.test(v) && Number.isSafeInteger(Number(v)),
            )
          : params.length === 0
    if (
      url.origin !== 'https://eizhu.yuweinfo.com' ||
      !url.pathname.startsWith(base) ||
      url.username ||
      url.password ||
      url.hash ||
      !allowed ||
      !query ||
      new Set(params.map(([k]) => k)).size !== params.length ||
      (request.method === 'GET' && request.body !== undefined)
    )
      ctx.addIssue({ code: 'custom', message: '同步网络请求未授权' })
  })
export const syncEventRequestSchema = z.strictObject({
  authorization: z
    .string()
    .regex(/^Bearer [^\r\n]+$/)
    .max(32775),
})
