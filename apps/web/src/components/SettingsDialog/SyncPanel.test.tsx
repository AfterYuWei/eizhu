// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SyncPanel } from './SyncPanel'
import { syncApi } from '@/api/sync'
import { vaultApi } from '@/api/vault'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAccountStore } from '@/store/account'
import { useSyncStore } from '@/store/sync'
import type { SyncStatus, SyncConflict } from '@/types/sync'
vi.mock('@/api/sync', () => ({
  syncApi: {
    status: vi.fn(),
    conflicts: vi.fn(),
    revealConflictCredentials: vi.fn(),
    syncNow: vi.fn(),
    unlock: vi.fn(),
    changePassword: vi.fn(),
    preview: vi.fn(),
    bootstrap: vi.fn(),
    resolveConflict: vi.fn(),
    resolveConflicts: vi.fn(),
  },
}))
vi.mock('@/api/vault', () => ({ vaultApi: { list: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/lib/desktopActions', () => ({ runDesktopAction: vi.fn() }))
let host: HTMLDivElement, root: Root
const initial: SyncStatus = {
  status: 'pending_setup',
  pendingCount: 1,
  conflictCount: 0,
  cursor: 0,
  initialized: false,
  unlocked: true,
  lastConfirmed: null,
  lastError: '',
  items: [],
}
beforeEach(async () => {
  vi.resetAllMocks()
  vi.mocked(vaultApi.list).mockResolvedValue([])
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.mocked(syncApi.status).mockResolvedValue(initial)
  vi.mocked(syncApi.conflicts).mockResolvedValue([])
  vi.mocked(syncApi.preview).mockResolvedValue({
    token: '22222222-2222-4222-8222-222222222222',
    localCount: 2,
    offlineCount: 1,
    accountCount: 1,
    cloudCount: 3,
    conflictCount: 1,
  })
  useAccountStore.setState(
    {
      ...useAccountStore.getInitialState(),
      status: {
        loggedIn: true,
        sessionState: 'authenticated',
        syncEnabled: false,
        user: {
          id: 42,
          email: 'sync@example.invalid',
          emailVerified: true,
          verificationRequired: true,
          storageUsed: 0,
          storageQuota: 1000000,
        },
      },
    },
    true,
  )
  useSyncStore.setState(useSyncStore.getInitialState(), true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root.render(
      <TooltipProvider>
        <SyncPanel />
      </TooltipProvider>,
    ),
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
const click = async (text: string) =>
  act(async () => {
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!.click()
  })
it('defaults to previewing offline data; cancel preserves login and never bootstraps', async () => {
  await click('预览首次接入')
  expect(syncApi.preview).toHaveBeenCalledWith(true)
  expect(host.textContent).toContain('离线 1 条 · 账号本地 1 条 · 云端 3 条 · 冲突 1 条')
  await click('取消预览')
  expect(syncApi.bootstrap).not.toHaveBeenCalled()
  expect(useAccountStore.getState().status?.loggedIn).toBe(true)
  expect(useSyncStore.getState().status?.initialized).toBe(false)
})
it('uploads only after explicit merge confirmation and explains full replacement', async () => {
  await click('预览首次接入')
  await click('使用本地')
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('云端独有条目将提交删除标记')
  expect(syncApi.bootstrap).not.toHaveBeenCalled()
  await click('取消')
  await click('确认合并')
  await click('确认接入')
  expect(syncApi.bootstrap).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', 'merge')
})
it('uses the login key and offers no independent sync-password input', async () => {
  expect(host.querySelector('#sync-password')).toBeNull()
  expect(host.textContent).toContain('预览首次接入')
})

it('keeps conflict actions inside an independent dialog and only applies explicitly previewed choices', async () => {
  const conflict = {
    itemType: 'profile' as const,
    itemId: 'mock-profile',
    name: 'Mock 服务器',
    reason: 'concurrent_edit' as const,
    remoteRevision: 2,
    localRevision: 4,
    remoteSource: 'cloud' as const,
    localDeleted: false,
    remoteDeleted: false,
    local: { name: 'Mock 服务器', host: '192.0.2.12', note: '本机备注' },
    remote: { name: 'Mock 服务器', host: '192.0.2.18', note: '云端备注' },
  }
  vi.mocked(syncApi.conflicts).mockResolvedValue([conflict])
  vi.mocked(syncApi.status).mockResolvedValue({
    ...initial,
    initialized: true,
    conflictCount: 1,
    status: 'paused',
  })
  await act(async () => useSyncStore.getState().refresh())
  expect(host.textContent).toContain('1 项冲突待处理')
  expect(host.textContent).not.toContain('Mock 服务器')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await click('处理冲突')
  const dialog = () => document.querySelector('[role="dialog"]')!
  expect(dialog().textContent).toContain('合并工作台')
  expect(host.textContent).not.toContain('整条用本机')
  await click('整条用本机')
  expect(
    [...dialog().querySelectorAll('button')]
      .find((button) => button.textContent === '整条用本机')
      ?.getAttribute('aria-pressed'),
  ).toBe('true')
  expect(dialog().querySelector('[aria-label="主机地址：采用本机"]')?.getAttribute('aria-pressed')).toBe(
    'true',
  )
  await act(async () => dialog().querySelector<HTMLButtonElement>('[aria-label="备注：采用云端"]')!.click())
  expect(
    [...dialog().querySelectorAll('button')]
      .find((button) => button.textContent === '整条用本机')
      ?.getAttribute('aria-pressed'),
  ).toBe('false')
  expect(dialog().querySelector('[aria-label="主机地址：采用本机"]')?.getAttribute('aria-pressed')).toBe(
    'true',
  )
  await click('暂存此项')
  await click('稍后处理')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(syncApi.resolveConflicts).not.toHaveBeenCalled()
  await click('处理冲突')
  await click('预览已选（1）')
  expect(syncApi.resolveConflicts).not.toHaveBeenCalled()
  vi.mocked(syncApi.conflicts).mockResolvedValue([])
  await click('应用至本机')
  expect(syncApi.resolveConflicts).toHaveBeenCalledWith({
    localRevision: 4,
    resolutions: [
      {
        itemType: 'profile',
        itemId: 'mock-profile',
        remoteRevision: 2,
        remoteSource: 'cloud',
        choice: 'merge',
        fields: { host: 'local', note: 'cloud' },
      },
    ],
  })
  expect(dialog().textContent).toContain('本次冲突已处理')
  expect(useAccountStore.getState().status?.syncEnabled).toBe(false)
})

it('opens a focused conflict in the dialog and does not replay stale staged selections', async () => {
  const conflict = {
    itemType: 'snippet' as const,
    itemId: 'deleted',
    name: '删除冲突',
    reason: 'concurrent_edit' as const,
    remoteRevision: 2,
    localRevision: 4,
    remoteSource: 'cloud' as const,
    localDeleted: true,
    remoteDeleted: false,
    local: null,
    remote: { name: '删除冲突', content: 'echo mock' },
  }
  vi.mocked(syncApi.conflicts).mockResolvedValue([conflict])
  await act(async () => useSyncStore.getState().refresh())
  await act(async () => useSyncStore.getState().focusConflict('snippet', 'deleted'))
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('删除与修改冲突')
  expect(document.querySelector('[aria-label="保留本机删除"]')?.getAttribute('data-deleted')).toBe('true')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('echo mock')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="恢复云端条目"]')!.click())
  expect(document.querySelector('[aria-label="恢复云端条目"]')?.getAttribute('aria-pressed')).toBe('true')
  expect(document.querySelector('[aria-label="保留本机删除"]')?.getAttribute('aria-pressed')).toBe('false')
  await click('暂存此项')
  vi.mocked(syncApi.conflicts).mockResolvedValue([{ ...conflict, localRevision: 5 }])
  await act(async () => useSyncStore.getState().refresh())
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('数据已变化')
  const preview = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === '预览已选（1）',
  )!
  expect(preview.disabled).toBe(true)
  expect(syncApi.resolveConflicts).not.toHaveBeenCalled()
})

it('explains credential differences, reveals both versions only on demand and clears them on close', async () => {
  const conflict: SyncConflict = {
    itemType: 'vault' as const,
    itemId: 'credential',
    name: '部署凭据',
    reason: 'concurrent_edit' as const,
    remoteRevision: 2,
    localRevision: 4,
    remoteSource: 'offline' as const,
    localDeleted: false,
    remoteDeleted: false,
    local: {
      name: '部署凭据',
      type: 'password',
      credential_changed: true,
      credential_fields: ['type', 'password'],
      credential_differences: ['type', 'password', 'private_key'],
      updated_at: '2026-11-05T01:00:00Z',
    },
    remote: {
      name: '部署凭据',
      type: 'private_key',
      fingerprint: 'SHA256:fixture',
      credential_changed: true,
      credential_fields: ['type', 'private_key'],
      credential_differences: ['type', 'password', 'private_key'],
      updated_at: '2026-11-04T01:00:00Z',
    },
  }
  vi.mocked(syncApi.conflicts).mockResolvedValue([conflict])
  vi.mocked(syncApi.revealConflictCredentials).mockResolvedValue({
    local: { password: 'fixture-local-secret' },
    remote: { private_key: 'fixture-remote-key' },
  })
  await act(async () => useSyncStore.getState().refresh())
  await act(async () => useSyncStore.getState().focusConflict('vault', 'credential'))
  const dialog = () => document.querySelector('[role="dialog"]')!
  expect(dialog().textContent).toContain('差异：凭据类型、密码、私钥')
  expect(dialog().textContent).toContain('密码：已设置')
  expect(dialog().textContent).toContain('SHA256:fixture')
  expect(dialog().textContent).toContain('条目修改时间')
  expect(syncApi.revealConflictCredentials).not.toHaveBeenCalled()
  await click('查看双方凭据')
  expect(syncApi.revealConflictCredentials).toHaveBeenCalledWith({
    itemType: 'vault',
    itemId: 'credential',
    localRevision: 4,
    remoteRevision: 2,
    remoteSource: 'offline',
  })
  expect(dialog().querySelector('[aria-label="本机凭据内容"]')?.textContent).toContain('fixture-local-secret')
  expect(dialog().querySelector('[aria-label="离线副本凭据内容"]')?.textContent).toContain(
    'fixture-remote-key',
  )
  await click('隐藏双方凭据')
  expect(dialog().textContent).not.toContain('fixture-local-secret')
  await click('查看双方凭据')
  await click('稍后处理')
  await act(async () => useSyncStore.getState().focusConflict('vault', 'credential'))
  expect(dialog().textContent).not.toContain('fixture-local-secret')
  expect(syncApi.resolveConflicts).not.toHaveBeenCalled()
})

it('ignores a credential reveal response after switching away from the conflict', async () => {
  const conflict = {
    itemType: 'vault' as const,
    itemId: 'credential',
    name: '凭据',
    reason: 'concurrent_edit' as const,
    remoteRevision: 2,
    localRevision: 4,
    remoteSource: 'cloud' as const,
    localDeleted: false,
    remoteDeleted: false,
    local: {
      credential_changed: true,
      credential_fields: ['password' as const],
      credential_differences: ['password' as const],
    },
    remote: {
      credential_changed: true,
      credential_fields: ['password' as const],
      credential_differences: ['password' as const],
    },
  }
  vi.mocked(syncApi.conflicts).mockResolvedValue([
    conflict,
    { ...conflict, itemId: 'other', name: '另一凭据' },
  ])
  let complete!: (value: { local: { password: string }; remote: { password: string } }) => void
  vi.mocked(syncApi.revealConflictCredentials).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  await act(async () => useSyncStore.getState().refresh())
  await act(async () => useSyncStore.getState().focusConflict('vault', 'credential'))
  await click('查看双方凭据')
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('.sync-conflict-list button')]
      .find((button) => button.textContent?.includes('另一凭据'))!
      .click(),
  )
  await act(async () => complete({ local: { password: 'late-secret' }, remote: { password: 'late-secret' } }))
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('late-secret')
  expect(
    [...document.querySelectorAll('button')].some((button) => button.textContent === '查看双方凭据'),
  ).toBe(true)
})

it('discards staged choices when account ownership changes, even if conflict IDs and revisions match', async () => {
  const conflict = {
    itemType: 'group' as const,
    itemId: 'same-id',
    name: '分组',
    reason: 'concurrent_edit' as const,
    remoteRevision: 1,
    localRevision: 2,
    remoteSource: 'cloud' as const,
    localDeleted: false,
    remoteDeleted: false,
    local: { name: '本机分组' },
    remote: { name: '云端分组' },
  }
  vi.mocked(syncApi.conflicts).mockResolvedValue([conflict])
  await act(async () => useSyncStore.getState().refresh())
  await click('处理冲突')
  await click('整条用本机')
  await click('暂存此项')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('已暂存 1 / 1 项')
  const previous = useAccountStore.getState().status!
  if (!previous.loggedIn) throw new Error('Expected authenticated fixture')
  await act(async () =>
    useAccountStore.setState({ status: { ...previous, user: { ...previous.user, id: 99 } } }),
  )
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('已暂存 0 / 1 项')
  expect(syncApi.resolveConflicts).not.toHaveBeenCalled()
})
