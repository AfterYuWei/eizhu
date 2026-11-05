import { fail, SYNC_MERGE_FIELDS } from '@eizhu/contracts'
import type { SyncResolution } from '@eizhu/contracts'
import { payloadSchema } from '../local/model.ts'
import { kindOf, summary } from './model.ts'
import type { Entity, ItemType } from './model.ts'

/** Only field-side decisions cross IPC; credential bodies remain inside the database Worker. */
export function mergeConflictValue(
  type: ItemType,
  local: Entity | null,
  remote: Entity | null,
  fields: NonNullable<SyncResolution['fields']>,
): Entity {
  if (!local || !remote) fail('SYNC_MERGE_INVALID', '删除冲突请明确选择保留删除或恢复条目')
  const left = summary(type, local, remote),
    right = summary(type, remote, local)
  for (const field of SYNC_MERGE_FIELDS[type]) {
    const changed =
      field === 'credential_changed' || field === 'options_changed'
        ? left?.[field] === true
        : JSON.stringify(left?.[field]) !== JSON.stringify(right?.[field])
    if (changed && !fields[field]) fail('SYNC_MERGE_INVALID', '请为每个变化字段选择来源')
  }
  const merged: Record<string, unknown> = { ...local }
  for (const [field, side] of Object.entries(fields)) {
    if (!side) continue
    const source: Record<string, unknown> = { ...(side === 'local' ? local : remote) }
    if (field === 'credential_changed') {
      const keys =
        type === 'vault'
          ? ['credential', 'type', 'fingerprint']
          : ['inline_credential', 'proxy_password', 'auth_type', 'vault_id']
      for (const key of keys) merged[key] = source[key]
    } else if (field === 'options_changed') merged.options = source.options
    else merged[field] = source[field]
  }
  return payloadSchema.shape[kindOf[type]].unwrap().element.parse(merged) as Entity
}
