import { z } from 'zod'

const id = z.uuid()
const text = z.string().max(512)
const secret = z.string().max(16384)
export const backupPreferencesSchema = z.strictObject({
  scheduled_enabled: z.boolean(),
  scheduled_interval_hours: z.int().min(0).max(8760),
  scheduled_daily_time: z.string().regex(/^(|([01]\d|2[0-3]):[0-5]\d)$/),
  auto_backup_enabled: z.boolean(),
  change_debounce_seconds: z.int().min(1).max(3600),
})
export const backupSettingsSchema = backupPreferencesSchema.extend({
  directory: z.string().min(1).max(32768).nullable(),
  backup_password_set: z.boolean(),
})
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

const empty = z.undefined(),
  done = z.void(),
  saved = z.strictObject({ saved: z.boolean() })
const byId = z.strictObject({ id })
export const archive = {
  'backup.getSettings': { input: empty, output: backupSettingsSchema },
  'backup.updateSettings': {
    input: z.strictObject({
      settings: backupPreferencesSchema.refine(
        (s) => !s.scheduled_enabled || s.scheduled_interval_hours > 0 || !!s.scheduled_daily_time,
        '定时备份必须设置间隔或每日时间',
      ),
      backupPassword: secret.min(6).optional(),
    }),
    output: saved,
  },
  'backup.backupNow': {
    input: empty,
    output: z.strictObject({
      path: z.string().min(1).max(32768),
      uploaded: z.int().nonnegative(),
      failed: z.int().nonnegative(),
    }),
  },
  'backup.status': {
    input: empty,
    output: z.strictObject({
      status: z.enum(['idle', 'backing_up', 'error']),
      last_backup_at: text.nullable(),
      last_backup_path: z.string().max(32768).nullable(),
      last_error: text.nullable(),
      providers: z.array(targetSchema).max(32),
    }),
  },
  'backup.targets': { input: empty, output: z.array(targetSchema).max(32) },
  'backup.createProvider': { input: z.strictObject({ config: providerConfigSchema }), output: targetSchema },
  'backup.updateProvider': { input: byId.extend({ config: providerConfigSchema }), output: saved },
  'backup.deleteProvider': { input: byId, output: done },
  'backup.testProvider': { input: byId, output: saved },
  'backup.oauthUrl': {
    input: z.strictObject({ providerType: z.enum(['gdrive', 'onedrive']), providerId: id }),
    output: z.strictObject({ url: z.url() }),
  },
} as const
export type ArchiveOperation = keyof typeof archive
export function isArchiveOperation(op: string): op is ArchiveOperation {
  return Object.hasOwn(archive, op)
}
export type ProviderConfig = z.infer<typeof providerConfigSchema>
