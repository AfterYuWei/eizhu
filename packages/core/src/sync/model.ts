import { z } from 'zod'
import { fail, syncSummarySchema, syncWireItemSchema } from '@eizhu/contracts'
import type { SyncConflict } from '@eizhu/contracts'
import { emptyPayload, orderedPayload, payloadSchema, proxyOf, validateGraph } from '../local/model.ts'
import type { Payload, Kind, StoredProfile, StoredVault } from '../local/model.ts'

export const kindOf = { group: 'groups', vault: 'vault', profile: 'profiles', snippet: 'snippets' } as const
export const typeOf = { groups: 'group', vault: 'vault', profiles: 'profile', snippets: 'snippet' } as const
export type ItemType = keyof typeof kindOf
export type Entity = Payload[Kind][number]
export const identity = (type: ItemType, id: string) => `${type}:${id}`
export type Remote = {
  itemType: ItemType
  itemId: string
  revision: number
  epoch: number
  value: Entity | null
}
export const remoteSchema = z
  .strictObject({
    itemType: z.enum(['group', 'vault', 'profile', 'snippet']),
    itemId: z.string().min(1).max(200),
    revision: z.int().nonnegative(),
    epoch: z.int().positive(),
    value: z.unknown(),
  })
  .transform((r): Remote => ({
    ...r,
    value:
      r.value === null
        ? null
        : (payloadSchema.shape[kindOf[r.itemType]].unwrap().element.parse(r.value) as Entity),
  }))
export type WireItem = z.infer<typeof syncWireItemSchema>
export type PlainItem = WireItem & { value: Entity | null }
export function entries(payload: Payload): Array<{ itemType: ItemType; itemId: string; value: Entity }> {
  return (Object.keys(kindOf) as ItemType[]).flatMap((itemType) =>
    payload[kindOf[itemType]].map((value) => ({ itemType, itemId: value.id, value })),
  )
}
export function get(payload: Payload, type: ItemType, id: string): Entity | null {
  return payload[kindOf[type]].find((v) => v.id === id) ?? null
}
export function put(payload: Payload, type: ItemType, id: string, value: Entity | null): void {
  const rows = payload[kindOf[type]] as Entity[]
  const index = rows.findIndex((v) => v.id === id)
  if (index >= 0) rows.splice(index, 1)
  if (value) rows.push(value)
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    )
  return value
}
/** Timestamps are metadata, not an edit. Object key order must not manufacture conflicts. */
export function equal(a: Entity | null, b: Entity | null): boolean {
  const normalize = (v: Entity | null) => {
    if (!v) return null
    const copy: Record<string, unknown> = { ...v }
    delete copy.created_at
    delete copy.updated_at
    if (typeof copy.options === 'string') {
      try {
        copy.options = JSON.parse(copy.options)
        if (copy.options && typeof copy.options === 'object')
          delete (copy.options as Record<string, unknown>).host_key_fingerprint
      } catch {
        /* Graph validation reports invalid options. */
      }
    }
    return canonical(copy)
  }
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}
export function graph(payload: Payload): void {
  payloadSchema.parse(payload)
  validateGraph(payload)
}
function portableOptions(options: string): string {
  const value = JSON.parse(options) as Record<string, unknown>
  delete value.host_key_fingerprint
  return JSON.stringify(value)
}
/** Preserve the established SQLite portable row format, independently of local backup v1. */
export function portable(type: ItemType, value: Entity | null): unknown {
  if (!value) return null
  const p = emptyPayload()
  ;(p[kindOf[type]] as Entity[]).push(value)
  const v = orderedPayload(p)[kindOf[type]][0] as unknown as Record<string, unknown>
  if (type === 'vault') {
    const item = value as StoredVault,
      c = item.credential
    const data = item.type === 'password' ? (c?.password ?? '') : `\u0001${JSON.stringify(c ?? {})}`
    const { credential: _, ...rest } = v
    void _
    return { ...rest, data }
  }
  if (type === 'profile') {
    const item = value as StoredProfile
    const { inline_credential: _, proxy_password: __, ...rest } = v
    void _
    void __
    return {
      ...rest,
      ...(typeof item.options === 'string' && item.options ? { options: portableOptions(item.options) } : {}),
      tags: JSON.stringify(item.tags),
      inline_credential: item.inline_credential ? JSON.stringify(item.inline_credential) : '',
      proxy_credential: item.proxy_password ?? '',
    }
  }
  if (type === 'snippet') return { ...v, tags: JSON.stringify(v.tags), is_global: v.is_global ? 1 : 0 }
  return v
}
export function fromPortable(type: ItemType, id: string, raw: unknown): Entity {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error()
    const v = { ...raw } as Record<string, unknown>
    if (v.id !== id) throw new Error()
    for (const k of ['parent_id', 'group_id', 'vault_id']) if (v[k] === null || v[k] === '') delete v[k]
    if (typeof v.tags === 'string') v.tags = JSON.parse(v.tags)
    if (type === 'vault') {
      if (typeof v.data !== 'string') throw new Error()
      if (v.type === 'password') v.credential = { password: v.data }
      else if (v.data.startsWith('\u0001')) v.credential = JSON.parse(v.data.slice(1))
      else {
        const [private_key, passphrase] = v.data.split('\0', 2)
        v.credential = { private_key, ...(passphrase ? { passphrase } : {}) }
      }
      delete v.data
    }
    if (type === 'profile') {
      if (typeof v.inline_credential === 'string')
        v.inline_credential = v.inline_credential ? JSON.parse(v.inline_credential) : undefined
      if (typeof v.proxy_credential === 'string' && v.proxy_credential) v.proxy_password = v.proxy_credential
      delete v.proxy_credential
      if (v.options && typeof v.options === 'object') v.options = JSON.stringify(v.options)
      if (typeof v.options === 'string' && v.options) {
        try {
          v.options = portableOptions(v.options)
        } catch {
          /* Invalid dependency is retained for conflict handling. */
        }
      }
    }
    if (type === 'snippet') v.is_global = v.is_global === true || v.is_global === 1
    return payloadSchema.shape[kindOf[type]].unwrap().element.parse(v) as Entity
  } catch {
    return fail('SYNC_CONTENT', '云端条目格式无效，本地数据已保留')
  }
}
export function summary(type: ItemType, value: Entity | null, other?: Entity | null): SyncConflict['local'] {
  if (!value) return null
  const v = value as unknown as Record<string, unknown>,
    result: Record<string, unknown> = {}
  const fields: Record<ItemType, string[]> = {
    group: ['name', 'parent_id', 'icon', 'sort_order'],
    vault: ['name', 'type', 'username', 'remark', 'fingerprint'],
    profile: ['name', 'host', 'port', 'username', 'auth_type', 'group_id', 'vault_id', 'tags', 'note'],
    snippet: ['name', 'content', 'description', 'tags', 'is_global'],
  }
  for (const key of fields[type]) if (v[key] !== undefined) result[key] = v[key]
  if (type === 'profile') {
    try {
      result.jump_profile_id = proxyOf(value as StoredProfile).jump_profile_id
    } catch {
      /* A malformed remote dependency must remain inspectable without exposing raw options. */
    }
  }
  if (type === 'profile' || type === 'vault') {
    const secrets = (item: Entity | null | undefined) => {
      const v = item as unknown as Record<string, unknown> | null
      return JSON.stringify([v?.credential, v?.inline_credential, v?.proxy_password])
    }
    result.credential_changed = secrets(value) !== secrets(other)
  }
  return syncSummarySchema.parse(result)
}

export function dependencies(type: ItemType, value: Entity): Array<{ type: ItemType; id: string }> {
  const v = value as unknown as Record<string, unknown>,
    refs: Array<{ type: ItemType; id: string }> = []
  const add = (type: ItemType, id: unknown) => {
    if (typeof id === 'string' && id) refs.push({ type, id })
  }
  if (type === 'group') add('group', v.parent_id)
  if (type === 'profile') {
    add('group', v.group_id)
    add('vault', v.vault_id)
    add('profile', proxyOf(value as StoredProfile).jump_profile_id)
  }
  return refs
}
