import { z } from 'zod'
import { fail, credentialSchema, groupSchema, snippetSchema, proxyInputSchema } from '@eizhu/contracts'

const zeroTime = '0001-01-01T00:00:00Z'
const text = z.string().max(1024 * 1024)
const id = z.string().min(1).max(160)
const timestamp = z.string().max(64).default(zeroTime)
const opt = z.string().max(160).optional()
export const backupGroupSchema = groupSchema.extend({ parent_id: opt, created_at: timestamp })
export const backupVaultSchema = z.object({
  id,
  name: z.string().min(1).max(512),
  type: z.enum(['password', 'private_key']),
  username: z.string().max(512),
  remark: text,
  fingerprint: z.string().max(256),
  credential: credentialSchema.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
})
export const backupProfileSchema = z.object({
  id,
  name: z.string().max(512),
  host: z.string().trim().min(1).max(512),
  port: z.int().min(1).max(65535),
  username: z.string().max(512),
  auth_type: z.enum(['none', 'password', 'key', 'agent', 'vault']),
  icon: z.string().max(512).optional(),
  vault_id: opt,
  inline_credential: credentialSchema
    .nullish()
    .transform((value) => value ?? undefined)
    .optional(),
  proxy_password: text.optional(),
  group_id: opt,
  tags: z.array(z.string().max(256)).max(100).default([]),
  options: z
    .string()
    .max(64 * 1024)
    .default(''),
  note: z
    .string()
    .max(64 * 1024)
    .default(''),
  sort_order: z.int(),
  created_at: timestamp,
  updated_at: timestamp,
})
export const payloadSchema = z.object({
  groups: z.array(backupGroupSchema).max(50000).default([]),
  vault: z.array(backupVaultSchema).max(50000).default([]),
  profiles: z.array(backupProfileSchema).max(50000).default([]),
  snippets: z
    .array(
      snippetSchema.extend({
        description: z
          .string()
          .max(64 * 1024)
          .default(''),
        tags: snippetSchema.shape.tags.default([]),
        created_at: timestamp,
        updated_at: timestamp,
      }),
    )
    .max(50000)
    .default([]),
})
export type Payload = z.infer<typeof payloadSchema>
export type StoredProfile = Payload['profiles'][number]
export type StoredVault = Payload['vault'][number]
export const kinds = ['groups', 'vault', 'profiles', 'snippets'] as const
export type Kind = (typeof kinds)[number]
export const emptyPayload = (): Payload => ({ groups: [], vault: [], profiles: [], snippets: [] })
export function optionsOf(options: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(options || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    const root = value as Record<string, unknown>
    if (['password', 'private_key', 'passphrase', 'proxy_password'].some((key) => Object.hasOwn(root, key)))
      throw new Error()
    return root
  } catch {
    return fail('INVALID_OPTIONS', '连接高级配置不是有效或安全的 JSON 对象')
  }
}
export function proxyOf(profile: Pick<StoredProfile, 'options'>) {
  const root = optionsOf(profile.options)
  const proxy = proxyInputSchema.omit({ password: true }).safeParse(root.proxy ?? { type: 'direct' })
  if (!proxy.success) return fail('INVALID_PROXY_CONFIG', '代理配置无效')
  const p = proxy.data
  if ((p.type === 'http' || p.type === 'socks5') && (!p.host?.trim() || !p.port))
    fail('INVALID_PROXY_CONFIG', '代理主机和端口不能为空')
  if (p.type === 'jump' && !p.jump_profile_id) fail('INVALID_PROXY_CONFIG', '请选择跳板服务器')
  return p
}

/** Validate the whole candidate graph before any database writes, including merged imports. */
export function validateGraph(payload: Payload): void {
  for (const kind of kinds) {
    const ids = payload[kind].map((item) => item.id)
    if (new Set(ids).size !== ids.length) fail('VALIDATION', '数据中存在重复标识')
  }
  const groups = new Map(payload.groups.map((item) => [item.id, item]))
  const profiles = new Map(payload.profiles.map((item) => [item.id, item]))
  const vault = new Map(payload.vault.map((item) => [item.id, item]))
  const checkedGroups = new Set<string>()
  for (const group of payload.groups) {
    const visited = new Set<string>()
    let cursor: string | undefined = group.id
    while (cursor && !checkedGroups.has(cursor)) {
      if (visited.has(cursor)) fail('VALIDATION', '分组存在循环引用')
      visited.add(cursor)
      const item = groups.get(cursor)
      if (!item) fail('VALIDATION', '父分组不存在')
      cursor = item.parent_id
    }
    for (const id of visited) checkedGroups.add(id)
  }
  for (const item of payload.profiles) {
    if (item.group_id && !groups.has(item.group_id)) fail('VALIDATION', '服务器引用的分组不存在')
    if (item.auth_type === 'vault' && (!item.vault_id || !vault.has(item.vault_id)))
      fail('VALIDATION', '服务器引用的凭据不存在')
    if (item.vault_id && item.auth_type !== 'vault') fail('VALIDATION', '认证方式与凭据引用不一致')
    const visited = new Set<string>()
    let cursor: StoredProfile | undefined = item
    let depth = 0
    while (cursor) {
      if (visited.has(cursor.id)) fail('INVALID_PROXY_CHAIN', '跳板服务器存在循环引用')
      visited.add(cursor.id)
      const proxy = proxyOf(cursor)
      if (proxy.type !== 'jump') break
      if (++depth > 5) fail('INVALID_PROXY_CHAIN', '跳板服务器不能超过五级')
      cursor = profiles.get(proxy.jump_profile_id!)
      if (!cursor) fail('INVALID_PROXY_CHAIN', '跳板服务器不存在')
    }
  }
}
export function stripCredentials(payload: Payload): Payload {
  return {
    ...payload,
    vault: [],
    profiles: payload.profiles.map((item) => {
      const p = { ...item }
      delete p.inline_credential
      delete p.proxy_password
      delete p.vault_id
      if (p.auth_type === 'vault') p.auth_type = 'none'
      return p
    }),
  }
}
function optional(key: string, value: unknown) {
  return value ? { [key]: value } : {}
}
function orderedCredential(credential: StoredVault['credential']) {
  if (!credential) return null
  return {
    ...optional('password', credential.password),
    ...optional('private_key', credential.private_key),
    ...optional('public_key', credential.public_key),
    ...optional('passphrase', credential.passphrase),
  }
}
/** Rust serde field order and omission rules are part of the external v1 hash contract. */
export function orderedPayload(p: Payload) {
  return {
    groups: p.groups.map((g) => ({
      id: g.id,
      name: g.name,
      ...optional('parent_id', g.parent_id),
      icon: g.icon,
      sort_order: g.sort_order,
      created_at: g.created_at,
    })),
    vault: p.vault.map((v) => ({
      id: v.id,
      name: v.name,
      type: v.type,
      username: v.username,
      remark: v.remark,
      fingerprint: v.fingerprint,
      credential: orderedCredential(v.credential),
      created_at: v.created_at,
      updated_at: v.updated_at,
    })),
    profiles: p.profiles.map((v) => ({
      id: v.id,
      name: v.name,
      host: v.host,
      port: v.port,
      username: v.username,
      auth_type: v.auth_type,
      ...optional('icon', v.icon),
      ...optional('vault_id', v.vault_id),
      ...(v.inline_credential ? { inline_credential: orderedCredential(v.inline_credential) } : {}),
      ...optional('proxy_password', v.proxy_password),
      ...optional('group_id', v.group_id),
      tags: v.tags,
      ...optional('options', v.options),
      ...optional('note', v.note),
      sort_order: v.sort_order,
      created_at: v.created_at,
      updated_at: v.updated_at,
    })),
    snippets: p.snippets.map((v) => ({
      id: v.id,
      name: v.name,
      content: v.content,
      ...optional('description', v.description),
      tags: v.tags,
      is_global: v.is_global,
      created_at: v.created_at,
      updated_at: v.updated_at,
    })),
  }
}
