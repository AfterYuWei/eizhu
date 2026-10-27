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
})
export const syncConflictSchema = z.strictObject({
  itemType: syncItemTypeSchema,
  itemId,
  name: label,
  reason: z.enum(['concurrent_edit', 'dependency']),
  remoteRevision: integer,
  localDeleted: z.boolean(),
  remoteDeleted: z.boolean(),
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
})
export const syncMessageSchema = z.strictObject({
  workspaceGeneration: z.int().positive(),
  status: syncStatusSchema,
})
const password = z.string().min(6).max(1024)
export const sync = {
  'sync.status': { input: z.undefined(), output: syncStatusSchema },
  'sync.now': { input: z.undefined(), output: z.void() },
  'sync.unlock': { input: z.strictObject({ password }), output: z.void() },
  'sync.changePassword': { input: z.strictObject({ password }), output: z.void() },
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
  'sync.preview': { input: z.strictObject({ includeOffline: z.boolean() }), output: syncPreviewSchema },
  'sync.bootstrap': {
    input: z.strictObject({ token: z.uuid(), mode: z.enum(['merge', 'use_local', 'use_cloud']) }),
    output: z.void(),
  },
} as const
export type SyncStatus = z.infer<typeof syncStatusSchema>
export type ItemSyncStatus = SyncStatus['items'][number]
export type SyncConflict = z.infer<typeof syncConflictSchema>
export type SyncPreview = z.infer<typeof syncPreviewSchema>
