import { z } from 'zod'
import { restoreSchema } from './local.ts'

const id = z.uuid()
const text = z.string().max(512)
const secret = z.string().max(16384)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const count = z.int().nonnegative()
export const backupSettingsSchema = z
  .strictObject({
    sync_mode: z.enum(['manual', 'auto']),
    conflict_policy: z.enum(['prompt', 'latest']),
    cloud_retention: z.enum(['keep_forever', 'mirror_local']),
    local_keep_versions: z.int().min(0).max(1000),
    scheduled_enabled: z.boolean(),
    scheduled_interval_hours: z.int().min(0).max(8760),
    scheduled_daily_time: z.string().regex(/^(|([01]\d|2[0-3]):[0-5]\d)$/),
    auto_backup_enabled: z.boolean(),
    change_debounce_seconds: z.int().min(1).max(3600),
    backup_password_set: z.boolean(),
  })
  .refine(
    (s) => !s.scheduled_enabled || s.scheduled_interval_hours > 0 || !!s.scheduled_daily_time,
    '定时备份必须设置间隔或每日时间',
  )
const endpoint = z
  .string()
  .max(4096)
  .refine((raw) => {
    if (!raw) return true
    try {
      const u = new URL(raw)
      return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash
    } catch {
      return false
    }
  }, '目标地址必须是无内嵌凭据的 HTTP(S) 地址')
export const providerConfigSchema = z
  .strictObject({
    type: z.enum(['webdav', 's3', 'gdrive', 'onedrive']),
    name: text.trim().min(1),
    enabled: z.boolean(),
    endpoint: endpoint.optional(),
    username: text.optional(),
    password: secret.optional(),
    s3_endpoint: endpoint.optional(),
    s3_region: text.optional(),
    s3_bucket: text.optional(),
    s3_access_key: secret.optional(),
    s3_secret_key: secret.optional(),
    s3_prefix: text.optional(),
    s3_path_style: z.boolean().optional(),
    oauth_client_id: text.optional(),
    oauth_client_secret: secret.optional(),
    onedrive_folder: text.optional(),
  })
  .superRefine((c, ctx) => {
    if (c.type === 's3' && c.s3_bucket && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(c.s3_bucket))
      ctx.addIssue({ code: 'custom', message: 'S3 存储桶名称无效' })
    for (const value of [c.s3_prefix, c.onedrive_folder])
      if (value?.split(/[\\/]/).some((v) => v === '..' || v === '.'))
        ctx.addIssue({ code: 'custom', message: '目录不能包含相对路径段' })
  })
export const targetSchema = z.strictObject({
  id,
  type: z.enum(['webdav', 's3', 'gdrive', 'onedrive']),
  name: text,
  enabled: z.boolean(),
  authorized: z.boolean().optional(),
  created_at: text,
  updated_at: text,
})
export const versionInfoSchema = z.strictObject({ version: count, hash, size: count, created_at: text })
export const versionSchema = versionInfoSchema.extend({ id, origin: text, synced_to: z.array(id).max(32) })
export const eventSchema = z.strictObject({
  id,
  provider_id: text,
  action: text,
  version: count,
  success: z.boolean(),
  error: text.optional(),
  created_at: text,
})
export const cloudEntrySchema = versionInfoSchema.extend({
  object: z.string().regex(/^v\d+-[a-f0-9]{12,64}\.eizhubackup$/),
})
export const cloudIndexSchema = z
  .strictObject({
    format: z.literal('eizhu-sync-index'),
    version: z.literal(1),
    device_id: text,
    latest_version: count,
    versions: z.array(cloudEntrySchema).max(10000),
    updated_at: text,
  })
  .superRefine((i, ctx) => {
    if (
      new Set(i.versions.map((v) => v.version)).size !== i.versions.length ||
      new Set(i.versions.map((v) => v.object)).size !== i.versions.length ||
      i.latest_version !== Math.max(0, ...i.versions.map((v) => v.version))
    )
      ctx.addIssue({ code: 'custom', message: '云端目录版本不一致' })
  })
const byId = z.strictObject({ id })
const empty = z.undefined(),
  done = z.void(),
  saved = z.strictObject({ saved: z.boolean() })
export const archive = {
  'backup.getSettings': { input: empty, output: backupSettingsSchema },
  'backup.updateSettings': {
    input: z.strictObject({ settings: backupSettingsSchema, backupPassword: secret.min(6).optional() }),
    output: saved,
  },
  'backup.revealPassword': { input: empty, output: z.strictObject({ backup_password: secret }) },
  'backup.backupNow': {
    input: empty,
    output: z.strictObject({
      created: z.boolean(),
      message: text.optional(),
      version: versionSchema.optional(),
    }),
  },
  'backup.versions': { input: empty, output: z.array(versionSchema).max(1000) },
  'backup.deleteVersion': { input: byId.extend({ force: z.boolean() }), output: done },
  'backup.previewVersion': { input: byId.extend({ password: secret.optional() }), output: restoreSchema },
  'backup.targets': { input: empty, output: z.array(targetSchema).max(32) },
  'backup.createProvider': { input: z.strictObject({ config: providerConfigSchema }), output: targetSchema },
  'backup.updateProvider': { input: byId.extend({ config: providerConfigSchema }), output: saved },
  'backup.deleteProvider': { input: byId, output: done },
  'backup.testProvider': { input: byId, output: saved },
  'backup.oauthUrl': {
    input: z.strictObject({ providerType: z.enum(['gdrive', 'onedrive']), providerId: id }),
    output: z.strictObject({ url: z.url() }),
  },
  'backup.cloudVersions': {
    input: z.strictObject({ providerId: id }),
    output: z.array(z.strictObject({ object: text, size: count, createdAt: text })).max(10000),
  },
  'backup.previewCloud': {
    input: z.strictObject({
      providerId: id,
      object: cloudEntrySchema.shape.object,
      password: secret.optional(),
    }),
    output: restoreSchema,
  },
  'backup.submitLatest': { input: empty, output: z.strictObject({ started: z.boolean() }) },
  'backup.push': { input: empty, output: z.strictObject({ started: z.boolean() }) },
  'backup.events': {
    input: z.strictObject({ limit: z.int().min(1).max(500) }),
    output: z.array(eventSchema),
  },
  'backup.status': {
    input: empty,
    output: z.strictObject({
      status: z.enum(['idle', 'syncing', 'conflict', 'error']),
      local_latest: versionInfoSchema.nullable(),
      cloud_latest: z.record(id, versionInfoSchema),
      providers: z.array(targetSchema).max(32),
      conflict: z
        .strictObject({
          provider_id: id,
          provider_name: text,
          local: versionInfoSchema,
          cloud: versionInfoSchema,
        })
        .nullable(),
      last_sync_at: text.nullable(),
    }),
  },
} as const
export type ArchiveOperation = keyof typeof archive
export function isArchiveOperation(op: string): op is ArchiveOperation {
  return Object.hasOwn(archive, op)
}
export type ProviderConfig = z.infer<typeof providerConfigSchema>
export type CloudIndex = z.infer<typeof cloudIndexSchema>
export type CloudEntry = z.infer<typeof cloudEntrySchema>
