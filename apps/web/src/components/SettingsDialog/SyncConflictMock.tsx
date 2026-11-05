import { useState } from 'react'
import { DesktopError } from '@eizhu/contracts'
import type { SyncConflict } from '@eizhu/contracts'
import { SyncConflictWorkbench } from './SyncConflictDialog'

const version = {
  reason: 'concurrent_edit',
  localRevision: 1,
  remoteRevision: 2,
  remoteSource: 'cloud',
  localDeleted: false,
  remoteDeleted: false,
} as const
const initialConflicts: SyncConflict[] = [
  {
    ...version,
    itemType: 'group',
    itemId: 'mock-group',
    name: '【MOCK】生产环境',
    local: { name: '生产环境 · 本机', icon: 'server', sort_order: 0 },
    remote: { name: '生产环境 · 云端', icon: 'server', sort_order: 0 },
  },
  {
    ...version,
    itemType: 'vault',
    itemId: 'mock-vault',
    name: '【MOCK】运维密码',
    local: {
      name: '运维密码',
      type: 'password',
      username: 'deploy',
      remark: '本机保存的密码',
      credential_changed: true,
      credential_fields: ['type', 'password'],
      credential_differences: ['password'],
      updated_at: '2026-11-05T03:00:00Z',
    },
    remote: {
      name: '运维密码',
      type: 'password',
      username: 'deploy',
      remark: '云端保存的密码',
      credential_changed: true,
      credential_fields: ['type', 'password'],
      credential_differences: ['password'],
      updated_at: '2026-11-04T09:00:00Z',
    },
  },
  {
    ...version,
    itemType: 'profile',
    itemId: 'mock-profile',
    name: '【MOCK】应用服务器',
    local: {
      name: '应用服务器',
      host: '192.0.2.12',
      port: 22,
      username: 'deploy',
      auth_type: 'vault',
      vault_id: 'mock-vault',
      group_id: 'mock-group',
      note: '日志保留 14 天',
    },
    remote: {
      name: '应用服务器 · 云端改名',
      host: '192.0.2.18',
      port: 22,
      username: 'deploy',
      auth_type: 'vault',
      vault_id: 'mock-vault',
      group_id: 'mock-group',
      note: '日志保留 7 天',
    },
  },
  {
    ...version,
    itemType: 'profile',
    itemId: 'mock-cloud-deleted',
    name: '【MOCK】云端删除',
    remoteDeleted: true,
    local: {
      name: '本机保留的服务器',
      host: '192.0.2.20',
      port: 22,
      username: 'deploy',
      auth_type: 'agent',
      note: '本机仍需保留',
    },
    remote: null,
  },
  {
    ...version,
    itemType: 'snippet',
    itemId: 'mock-local-deleted',
    name: '【MOCK】本机删除',
    localDeleted: true,
    local: null,
    remote: {
      name: '日志清理',
      content: 'journalctl --vacuum-time=14d',
      description: '云端修改后保留的片段',
      is_global: true,
    },
  },
  {
    ...version,
    itemType: 'snippet',
    itemId: 'mock-snippet',
    name: '【MOCK】查看日志',
    local: {
      name: '查看日志',
      content: 'journalctl -n 200 --no-pager',
      description: '本机修改',
      is_global: true,
    },
    remote: {
      name: '查看日志',
      content: 'journalctl -n 50 --no-pager',
      description: '云端修改',
      is_global: true,
    },
  },
]

/** This fixture owns no stores, bridge calls, account sessions, storage or network. */
export default function SyncConflictMock({ onOpenChange }: { onOpenChange: (value: boolean) => void }) {
  const [conflicts, setConflicts] = useState(() => structuredClone(initialConflicts))
  return (
    <SyncConflictWorkbench
      open
      onOpenChange={onOpenChange}
      mock
      conflicts={conflicts}
      focusItem={null}
      groups={[{ id: 'mock-group', name: '【MOCK】生产环境' }]}
      profiles={[{ id: 'mock-profile', name: '【MOCK】应用服务器' }]}
      vaultNames={{ 'mock-vault': '【MOCK】运维密码' }}
      enabled={false}
      revealCredentials={async (input) => {
        if (
          !conflicts.some(
            (c) =>
              c.itemType === input.itemType &&
              c.itemId === input.itemId &&
              c.localRevision === input.localRevision &&
              c.remoteRevision === input.remoteRevision &&
              c.remoteSource === input.remoteSource,
          )
        )
          throw new DesktopError({ code: 'CONFLICT_CHANGED', message: '示例内容已变化，请重新打开预览。' })
        return input.itemType === 'vault'
          ? { local: { password: 'mock-local-password' }, remote: { password: 'mock-cloud-password' } }
          : { local: null, remote: null }
      }}
      resolveConflicts={async (input) => {
        setConflicts((previous) =>
          previous.filter(
            (c) => !input.resolutions.some((r) => r.itemType === c.itemType && r.itemId === c.itemId),
          ),
        )
      }}
    />
  )
}
