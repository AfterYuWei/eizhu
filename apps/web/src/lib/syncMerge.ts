import { SYNC_MERGE_FIELDS } from '@eizhu/contracts'
import type { SyncConflict, SyncMergeField, SyncResolution } from '@eizhu/contracts'

export const SYNC_FIELD_LABELS: Record<SyncMergeField, string> = {
  name: '名称',
  host: '主机地址',
  port: '端口',
  username: '用户名',
  group_id: '分组',
  parent_id: '父分组',
  icon: '图标',
  sort_order: '排序',
  remark: '备注',
  tags: '标签',
  note: '备注',
  content: '命令内容',
  description: '描述',
  is_global: '全局片段',
  credential_changed: '认证与凭据',
  options_changed: '连接高级配置',
}
export function syncChangedFields(conflict: SyncConflict): SyncMergeField[] {
  const fields: readonly SyncMergeField[] = SYNC_MERGE_FIELDS[conflict.itemType]
  return fields.filter((field) =>
    field === 'credential_changed' || field === 'options_changed'
      ? conflict.local?.[field] === true
      : JSON.stringify(conflict.local?.[field]) !== JSON.stringify(conflict.remote?.[field]),
  )
}
export function syncResolutionLabel(conflict: SyncConflict, choice: SyncResolution['choice']): string {
  if (choice === 'keep_both') return '保留双方，新增云端副本'
  if (choice === 'merge') return '按字段合并'
  if (choice === 'keep_local') return conflict.localDeleted ? '保留本机删除' : '整条使用本机'
  return conflict.remoteDeleted
    ? '采用云端删除'
    : conflict.remoteSource === 'offline'
      ? '使用离线副本'
      : '整条使用云端'
}
