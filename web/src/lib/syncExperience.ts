import type { SyncConflict, SyncStatus } from '@/types/sync'
import type { BackupEvent, BackupStatus, RestorePreview } from '@/types/backup'

export function recoveryFor(code = '', status = '') {
  if (['ACCOUNT_NOT_LOGGED_IN', 'ACCOUNT_DISABLED', 'ACCOUNT_UNAUTHORIZED', 'ACCOUNT_SESSION_EXPIRED'].includes(code)) return { kind: 'account', label: '重新登录', explanation: '登录状态已失效，请在账号设置中重新登录。本地修改仍然保留。' }
  if (status === 'locked' || ['SYNC_LOCKED', 'SYNC_PASSWORD', 'PASSWORD_REQUIRED', 'INVALID_PASSWORD', 'BACKUP_PASSWORD_REQUIRED'].includes(code)) return { kind: 'unlock', label: '设置或解锁密码', explanation: '需要解锁加密数据。同步密码与备份密码分别管理。' }
  if (code === 'ACCOUNT_QUOTA_EXCEEDED') return { kind: 'quota', label: '查看账号用量', explanation: '云端配额不足，请查看账号空间用量并处理配额后重试。本地保存已完成。' }
  if (status === 'offline' || ['NETWORK', 'NETWORK_ERROR', 'ACCOUNT_NETWORK', 'ACCOUNT_REQUEST_FAILED', 'ACCOUNT_UNAVAILABLE', 'ACCOUNT_FAILED'].includes(code)) return { kind: 'network', label: '联网后重试', explanation: '请检查网络连接后重试。尚未确认的修改会保留在本地队列。' }
  return { kind: 'retry', label: '重试', explanation: '处理错误后可以重试；本地修改与云端确认分别记录。' }
}

export function restoreSourceLabel(source: RestorePreview['source']) {
  switch (source.kind) {
    case 'local_version': return `本地版本 v${source.version}`
    case 'cloud': return `云端备份：${source.providerName} · ${source.object}`
    case 'safety': return `覆盖前安全快照 · ${source.createdAt}`
    case 'legacy_account': return `旧账号备份 v${source.version} · ${source.object}`
    case 'file': return `备份文件：${source.name}`
  }
}

export function backupDiagnostic(status: BackupStatus | null, events: BackupEvent[]) {
  return JSON.stringify({ schema: 1, capturedAt: new Date().toISOString(), backup: status ? {
    status: status.status, lastSyncAt: status.last_sync_at, latestVersion: status.local_latest?.version ?? null,
    targets: status.providers.map((p) => ({ type: p.type, enabled: p.enabled, authorized: p.authorized })),
    recentEvents: events.slice(0, 50).map((e) => ({ action: e.action, version: e.version, success: e.success, createdAt: e.created_at })),
  } : null }, null, 2)
}
export function conflictDependencies(conflict: SyncConflict) {
  const result = new Map<string, { type: string; id: string }>()
  for (const summary of [conflict.local, conflict.remote]) {
    for (const [field, type] of [['group_id', 'group'], ['parent_id', 'group'], ['vault_id', 'vault'], ['jump_profile_id', 'profile']]) {
      const id = summary?.[field]
      if (typeof id === 'string' && id) result.set(`${type}:${id}`, { type, id })
    }
  }
  return [...result.values()]
}
/** Explicit whitelist: never export item names/content, raw errors, provider settings or tokens. */
export function syncDiagnostic(status: SyncStatus | null) {
  return JSON.stringify({ schema: 1, capturedAt: new Date().toISOString(), sync: status ? {
    status: status.status, errorCode: status.lastErrorCode ?? '', pendingCount: status.pendingCount,
    conflictCount: status.conflictCount, initialized: status.initialized, unlocked: status.unlocked,
    cursor: status.cursor, lastConfirmed: status.lastConfirmed,
    itemStates: status.items.reduce<Record<string, number>>((counts, item) => { counts[item.status] = (counts[item.status] ?? 0) + 1; return counts }, {}),
  } : null }, null, 2)
}
