import { z } from 'zod'

const integer = z.int().nonnegative()
const itemId = z.string().min(1).max(200)
export const syncItemTypeSchema = z.enum(['group', 'vault', 'profile', 'snippet'])
export const syncStateSchema = z.enum([
  'pending_setup',
  'locked',
  'pending',
  'syncing',
  'synced',
  'offline',
  'error',
  'conflict',
  'paused',
])
const label = z.string().max(512)
const text = z.string().max(64 * 1024)
/** Deliberate allowlist: options and credential fields must not reach conflict UI. */
export const syncSummarySchema = z.strictObject({
  name: label.optional(),
  host: label.optional(),
  port: z.int().min(1).max(65535).optional(),
  username: label.optional(),
  auth_type: label.optional(),
  group_id: itemId.nullable().optional(),
  vault_id: itemId.nullable().optional(),
  jump_profile_id: itemId.nullable().optional(),
  parent_id: itemId.nullable().optional(),
  icon: label.optional(),
  sort_order: z.int().optional(),
  type: label.optional(),
  remark: text.optional(),
  fingerprint: label.optional(),
  tags: z.array(label).max(100).optional(),
  note: text.optional(),
  content: text.optional(),
  description: text.optional(),
  is_global: z.boolean().optional(),
  credential_changed: z.boolean().optional(),
  options_changed: z.boolean().optional(),
})
export const syncConflictSchema = z.strictObject({
  itemType: syncItemTypeSchema,
  itemId,
  name: label,
  reason: z.enum(['concurrent_edit', 'dependency']),
  remoteRevision: integer,
  localRevision: integer,
  localDeleted: z.boolean(),
  remoteDeleted: z.boolean(),
  remoteSource: z.enum(['cloud', 'offline']).optional(),
  local: syncSummarySchema.nullable().optional(),
  remote: syncSummarySchema.nullable().optional(),
})
export const syncStatusSchema = z.strictObject({
  status: syncStateSchema,
  pendingCount: integer,
  conflictCount: integer,
  cursor: integer,
  initialized: z.boolean(),
  unlocked: z.boolean(),
  lastConfirmed: z.string().max(64).nullable(),
  lastError: z.string().max(1024),
  lastErrorCode: z.string().max(100).optional(),
  items: z
    .array(
      z.strictObject({
        itemType: syncItemTypeSchema,
        itemId,
        generation: integer,
        name: label.optional(),
        status: syncStateSchema,
        deleted: z.boolean(),
      }),
    )
    .max(10000),
})
export const syncPreviewSchema = z.strictObject({
  token: z.uuid(),
  localCount: integer,
  offlineCount: integer,
  accountCount: integer,
  cloudCount: integer,
  conflictCount: integer,
  conflicts: z.array(syncConflictSchema).max(10000).optional(),
})
export const syncMessageSchema = z.strictObject({
  workspaceGeneration: z.int().positive(),
  status: syncStatusSchema,
  refresh: z.boolean().optional(),
})
export const SYNC_MERGE_FIELDS = {
  group: ['name', 'parent_id', 'icon', 'sort_order'],
  vault: ['name', 'username', 'remark', 'credential_changed'],
  profile: [
    'name',
    'host',
    'port',
    'username',
    'group_id',
    'icon',
    'sort_order',
    'tags',
    'note',
    'credential_changed',
    'options_changed',
  ],
  snippet: ['name', 'content', 'description', 'tags', 'is_global'],
} as const
const mergeField = z.enum([
  'name',
  'parent_id',
  'icon',
  'sort_order',
  'username',
  'remark',
  'host',
  'port',
  'group_id',
  'tags',
  'note',
  'credential_changed',
  'options_changed',
  'content',
  'description',
  'is_global',
])
export type SyncMergeField = z.infer<typeof mergeField>
export const syncResolutionSchema = z
  .strictObject({
    itemType: syncItemTypeSchema,
    itemId,
    remoteRevision: integer,
    remoteSource: z.enum(['cloud', 'offline']),
    choice: z.enum(['keep_local', 'use_cloud', 'merge', 'keep_both']),
    fields: z.partialRecord(mergeField, z.enum(['local', 'cloud'])).optional(),
  })
  .superRefine((value, context) => {
    if ((value.choice === 'merge') !== Boolean(value.fields))
      context.addIssue({ code: 'custom', message: '仅逐字段合并需要字段选择' })
    if (value.choice === 'keep_both' && value.itemType !== 'profile')
      context.addIssue({ code: 'custom', message: '仅服务器支持保留双方副本' })
    for (const field of Object.keys(value.fields ?? {}))
      if (!(SYNC_MERGE_FIELDS[value.itemType] as readonly string[]).includes(field))
        context.addIssue({ code: 'custom', message: '该条目不支持此合并字段' })
  })
export type SyncResolution = z.infer<typeof syncResolutionSchema>
export const syncResolveBatchSchema = z
  .strictObject({
    localRevision: integer,
    resolutions: z.array(syncResolutionSchema).min(1).max(10000),
  })
  .refine(
    (value) =>
      new Set(value.resolutions.map((r) => `${r.itemType}:${r.itemId}`)).size === value.resolutions.length,
    '不能重复处理同一条目',
  )
export type SyncResolveBatch = z.infer<typeof syncResolveBatchSchema>
export const sync = {
  'sync.status': { input: z.undefined(), output: syncStatusSchema },
  'sync.now': { input: z.undefined(), output: z.void() },
  'sync.conflicts': { input: z.undefined(), output: z.array(syncConflictSchema).max(10000) },
  'sync.resolveConflict': {
    input: z.strictObject({
      itemType: syncItemTypeSchema,
      itemId,
      choice: z.enum(['keep_local', 'use_cloud']),
      remoteRevision: integer,
    }),
    output: z.void(),
  },
  'sync.resolveConflicts': { input: syncResolveBatchSchema, output: z.void() },
  'sync.preview': { input: z.strictObject({ includeOffline: z.boolean() }), output: syncPreviewSchema },
  'sync.bootstrap': {
    input: z.strictObject({ token: z.uuid(), mode: z.enum(['merge', 'use_local', 'use_cloud']) }),
    output: z.void(),
  },
} as const
export type SyncOperation = keyof typeof sync
export function isSyncOperation(value: string): value is SyncOperation {
  return Object.hasOwn(sync, value)
}
export type SyncStatus = z.infer<typeof syncStatusSchema>
export type ItemSyncStatus = SyncStatus['items'][number]
export type SyncConflict = z.infer<typeof syncConflictSchema>
export type SyncPreview = z.infer<typeof syncPreviewSchema>
