// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SyncPanel } from './SyncPanel'
import { syncApi } from '@/api/sync'
import { useAccountStore } from '@/store/account'
import { useSyncStore } from '@/store/sync'
import type { SyncStatus } from '@/types/sync'
vi.mock('@/api/sync', () => ({
  syncApi: {
    status: vi.fn(),
    conflicts: vi.fn(),
    syncNow: vi.fn(),
    unlock: vi.fn(),
    changePassword: vi.fn(),
    preview: vi.fn(),
    bootstrap: vi.fn(),
    resolveConflict: vi.fn(),
  },
}))
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
  await act(async () => root.render(<SyncPanel />))
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
