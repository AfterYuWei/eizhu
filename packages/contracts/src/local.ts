import { z } from 'zod'

const id = z.string().min(1).max(160)
const label = z.string().max(512)
const secret = z.string().max(1024 * 1024)
const tags = z.array(z.string().max(256)).max(100)
const order = z.int()
const time = z.string().max(64)
const ready = z.void()
const empty = z.undefined()
const byId = z.strictObject({ id })
const optionalId = id.or(z.literal('')).optional()
export const credentialSchema = z.object({
  password: secret.optional(),
  private_key: secret.optional(),
  public_key: secret.optional(),
  passphrase: secret.optional(),
})
export const proxyInputSchema = z.strictObject({
  type: z.enum(['direct', 'socks5', 'http', 'jump']),
  host: label.optional(),
  port: z.int().min(1).max(65535).optional(),
  username: label.optional(),
  password: secret.optional(),
  jump_profile_id: optionalId,
})
const proxySchema = proxyInputSchema.omit({ password: true }).extend({ has_password: z.boolean().optional() })
const profileWrite = z.strictObject({
  name: label,
  host: label.trim().min(1),
  port: z.int().min(1).max(65535).optional(),
  username: label.trim().min(1),
  auth_type: z.enum(['password', 'key', 'agent', 'vault']),
  icon: label.optional(),
  vault_id: optionalId,
  ...credentialSchema.omit({ public_key: true }).shape,
  proxy: proxyInputSchema.optional(),
  group_id: optionalId,
  tags: tags.optional(),
  options: z
    .string()
    .max(64 * 1024)
    .optional(),
  note: z
    .string()
    .max(64 * 1024)
    .optional(),
  sort_order: order.optional(),
})
export const profileSchema = z.strictObject({
  id,
  name: label,
  host: label,
  port: z.int().min(1).max(65535),
  username: label,
  auth_type: z.enum(['none', 'password', 'key', 'agent', 'vault']),
  icon: label.optional(),
  vault_id: optionalId,
  proxy: proxySchema,
  group_id: optionalId,
  tags,
  options: z.string().max(64 * 1024),
  note: z.string().max(64 * 1024),
  sort_order: order,
  last_used_at: time.optional(),
  created_at: time,
  updated_at: time,
})
const groupWrite = z.strictObject({
  name: label.trim().min(1),
  parent_id: optionalId,
  icon: label.optional(),
  sort_order: order.optional(),
})
export const groupSchema = z.strictObject({
  id,
  name: label,
  parent_id: optionalId,
  icon: label,
  sort_order: order,
  created_at: time,
})
const vaultWrite = z.strictObject({
  name: label.trim().min(1),
  type: z.enum(['password', 'private_key']),
  username: label.optional(),
  remark: z
    .string()
    .max(64 * 1024)
    .optional(),
  ...credentialSchema.shape,
})
export const vaultSchema = z.strictObject({
  id,
  name: label,
  type: z.enum(['password', 'private_key']),
  username: label,
  remark: z.string(),
  fingerprint: z.string(),
  ref_count: z.int().nonnegative(),
  has_passphrase: z.boolean(),
  created_at: time,
  updated_at: time,
})
const snippetWrite = z.strictObject({
  name: label.trim().min(1),
  content: z
    .string()
    .min(1)
    .max(1024 * 1024),
  description: z
    .string()
    .max(64 * 1024)
    .optional(),
  tags: tags.optional(),
  is_global: z.boolean().optional(),
})
export const snippetSchema = snippetWrite.required().extend({ id, created_at: time, updated_at: time })
export const statsSchema = z.strictObject({
  groups: z.int().nonnegative(),
  vault: z.int().nonnegative(),
  profiles: z.int().nonnegative(),
  snippets: z.int().nonnegative(),
})
const change = z.strictObject({
  added: z.int().nonnegative(),
  changed: z.int().nonnegative(),
  unchanged: z.int().nonnegative(),
  removedInReplace: z.int().nonnegative(),
})
export const restoreSchema = z.strictObject({
  token: z.uuid(),
  stats: statsSchema,
  changes: z.strictObject({ groups: change, vault: change, profiles: change, snippets: change }),
  credentialMode: z.enum(['none', 'plain', 'encrypted']),
  exportedAt: time,
  source: z.strictObject({
    kind: z.enum(['file', 'safety', 'local_version', 'cloud']),
    version: z.int().nonnegative().optional(),
    origin: label.optional(),
    providerName: label.optional(),
    object: label.optional(),
    name: label.optional(),
    createdAt: time.optional(),
  }),
})
const previewSchema = z.strictObject({
  credential_mode: z.enum(['none', 'plain', 'encrypted']),
  exported_at: time,
  stats: statsSchema,
  conflicts: statsSchema,
})
export const auditSchema = z.strictObject({
  id: z.uuid(),
  action: z.string(),
  entity_id: z.string(),
  created_at: time,
})
const fileInput = z.strictObject({ filePath: z.string().min(1).max(32768), password: secret.optional() })
const descriptor = z.strictObject({ reference: id, name: label, size: z.int().nonnegative() })
let splitTree: z.ZodType = z.strictObject({ type: z.literal('leaf'), tabId: id })
for (let depth = 0; depth < 3; depth++)
  splitTree = z.union([
    z.strictObject({ type: z.literal('leaf'), tabId: id }),
    z.strictObject({
      type: z.literal('split'),
      id,
      axis: z.enum(['horizontal', 'vertical']),
      ratio: z.number().min(0.15).max(0.85),
      first: splitTree,
      second: splitTree,
    }),
  ])
const localStateWrite = z.discriminatedUnion('key', [
  z.strictObject({
    key: z.literal('history_settings'),
    value: z.strictObject({
      enabled: z.boolean(),
      maxEntries: z.int().min(1).max(5000),
      retentionDays: z.int().min(1).max(3650),
    }),
  }),
  z.strictObject({
    key: z.literal('shortcuts'),
    value: z.record(z.string().max(64), z.string().max(128)).refine((v) => Object.keys(v).length <= 128),
  }),
  z.strictObject({
    key: z.literal('terminal_layout'),
    value: z.strictObject({
      version: z.literal(1),
      tree: splitTree.nullable(),
      focusedId: id.nullable(),
      tabs: z.array(z.strictObject({ id, profileId: id })).max(128),
    }),
  }),
])

/** Stage 2 allowlist. Neither a reserved TypeScript method nor an arbitrary operation is executable. */
export const local = {
  'profile.list': {
    input: z.strictObject({ groupId: id.nullable(), search: label.nullable() }),
    output: z.array(profileSchema),
  },
  'profile.get': { input: byId, output: profileSchema },
  'profile.create': { input: z.strictObject({ request: profileWrite }), output: profileSchema },
  'profile.update': { input: byId.extend({ request: profileWrite.partial() }), output: profileSchema },
  'profile.delete': { input: byId, output: ready },
  'group.list': { input: empty, output: z.array(groupSchema) },
  'group.create': { input: z.strictObject({ request: groupWrite }), output: groupSchema },
  'group.update': { input: byId.extend({ request: groupWrite.partial() }), output: groupSchema },
  'group.delete': { input: byId, output: ready },
  'vault.list': {
    input: z.strictObject({ vaultType: z.enum(['password', 'private_key']).nullable(), q: label.nullable() }),
    output: z.array(vaultSchema),
  },
  'vault.get': { input: byId, output: vaultSchema },
  'vault.create': { input: z.strictObject({ request: vaultWrite }), output: vaultSchema },
  'vault.update': { input: byId.extend({ request: vaultWrite }), output: vaultSchema },
  'vault.delete': { input: byId, output: ready },
  'vault.references': { input: byId, output: z.array(z.strictObject({ id, name: label })) },
  'vault.reveal': { input: byId, output: credentialSchema },
  'vault.generateKeyPair': {
    input: z.strictObject({
      request: z.strictObject({
        algo: z.enum(['rsa', 'ed25519']),
        bits: z.union([z.literal(2048), z.literal(4096)]).optional(),
        passphrase: secret.optional(),
      }),
    }),
    output: z.strictObject({ public_key: secret, private_key: secret, fingerprint: z.string() }),
  },
  'snippet.list': { input: empty, output: z.array(snippetSchema) },
  'snippet.create': { input: z.strictObject({ request: snippetWrite }), output: snippetSchema },
  'snippet.update': { input: byId.extend({ request: snippetWrite.partial() }), output: snippetSchema },
  'snippet.delete': { input: byId, output: ready },
  'audit.list': { input: z.strictObject({ limit: z.int().min(1).max(500) }), output: z.array(auditSchema) },
  'audit.clear': { input: empty, output: ready },
  'localState.read': {
    input: z.strictObject({ key: z.enum(['history_settings', 'terminal_layout', 'shortcuts']) }),
    output: z.unknown().nullable(),
  },
  'localState.write': {
    input: localStateWrite,
    output: ready,
  },
  'backup.pickFile': { input: empty, output: z.strictObject({ name: label, reference: id }).nullable() },
  'backup.export': {
    input: z.strictObject({ mode: z.enum(['none', 'plain', 'encrypted']), password: secret.optional() }),
    output: z.string().nullable(),
  },
  'backup.preview': { input: fileInput, output: previewSchema },
  'backup.prepareRestore': { input: fileInput, output: restoreSchema },
  'backup.import': {
    input: fileInput.extend({ strategy: z.enum(['skip', 'overwrite', 'regenerate']) }),
    output: z.strictObject({
      imported: statsSchema,
      skipped: statsSchema,
      snapshot: z
        .strictObject({
          groups: z.array(groupSchema),
          profiles: z.array(profileSchema),
          vault: z.array(vaultSchema),
        })
        .optional(),
    }),
  },
  'backup.applyRestore': {
    input: z.strictObject({ token: z.uuid(), mode: z.enum(['merge', 'replace']) }),
    output: ready,
  },
  'backup.safetyVersions': {
    input: empty,
    output: z.array(z.strictObject({ id: z.uuid(), createdAt: time })),
  },
  'backup.previewSafety': { input: byId, output: restoreSchema },
  'document.pick': {
    input: z.strictObject({ multiple: z.boolean(), mimeTypes: z.array(label).max(16) }),
    output: z.array(descriptor),
  },
  'document.readText': {
    input: z.strictObject({
      reference: id,
      maxBytes: z
        .int()
        .min(1)
        .max(1024 * 1024),
    }),
    output: secret,
  },
  'document.release': { input: z.strictObject({ reference: id }), output: ready },
  'document.exportText': {
    input: z.strictObject({ content: secret, suggestedName: label.min(1), mimeType: label }),
    output: z.string().nullable(),
  },
} as const
export type LocalOperation = keyof typeof local
export type LocalInput<K extends LocalOperation> = z.infer<(typeof local)[K]['input']>
export type LocalOutput<K extends LocalOperation> = z.infer<(typeof local)[K]['output']>
export function isLocalOperation(operation: string): operation is LocalOperation {
  return Object.hasOwn(local, operation)
}
