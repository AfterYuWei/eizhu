import { SYNC_MERGE_FIELDS } from '@eizhu/contracts'
import type { SyncConflict, SyncMergeField, SyncResolution, SyncCredentialField } from '@eizhu/contracts'

export const SYNC_CREDENTIAL_FIELD_LABELS: Record<SyncCredentialField, string> = {
  type: '凭据类型',
  auth_type: '认证方式',
  vault_id: '关联凭据',
  password: '密码',
  private_key: '私钥',
  public_key: '公钥',
  passphrase: '私钥口令',
  proxy_password: '代理密码',
}
export function syncCredentialDescription(
  summary: SyncConflict['local'],
  vaultNames: Record<string, string>,
): string {
  if (!summary) return '已删除'
  const types: Record<string, string> = {
    password: '密码',
    private_key: '私钥',
    key: '私钥',
    agent: 'SSH Agent',
    vault: '引用凭据',
    none: '无认证',
  }
  const lines = [types[summary.auth_type ?? summary.type ?? ''] ?? '未设置认证方式']
  if (summary.vault_id) lines.push(`关联凭据：${vaultNames[summary.vault_id] ?? summary.vault_id}`)
  for (const field of ['password', 'private_key', 'public_key', 'passphrase', 'proxy_password'] as const) {
    if (summary.credential_fields?.includes(field) || summary.credential_differences?.includes(field))
      lines.push(
        `${SYNC_CREDENTIAL_FIELD_LABELS[field]}：${summary.credential_fields?.includes(field) ? '已设置' : '未设置'}`,
      )
  }
  if (summary.fingerprint) lines.push(`密钥指纹：${summary.fingerprint}`)
  if (summary.updated_at && !summary.updated_at.startsWith('0001-')) {
    const time = new Date(summary.updated_at)
    lines.push(
      `条目修改时间：${Number.isNaN(time.getTime()) ? summary.updated_at : time.toLocaleString('zh-CN', { hour12: false })}`,
    )
  }
  return lines.join('\n')
}

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
    ? `采用${conflict.remoteSource === 'offline' ? '离线副本' : '云端'}删除`
    : conflict.remoteSource === 'offline'
      ? '使用离线副本'
      : '整条使用云端'
}
