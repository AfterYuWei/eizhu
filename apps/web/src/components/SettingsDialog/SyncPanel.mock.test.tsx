// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { SyncPanel } from './SyncPanel'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAccountStore } from '@/store/account'
import { useSyncStore } from '@/store/sync'
import { syncApi } from '@/api/sync'

vi.hoisted(() => {
  vi.stubEnv('DEV', true)
  vi.stubEnv('VITE_EIZHU_MERGE_MOCK', '1')
})
vi.mock('@/api/sync', () => ({
  syncApi: {
    status: vi.fn().mockResolvedValue({
      status: 'pending_setup',
      pendingCount: 0,
      conflictCount: 0,
      cursor: 0,
      initialized: false,
      unlocked: false,
      lastConfirmed: null,
      lastError: '',
      items: [],
    }),
    conflicts: vi.fn().mockResolvedValue([]),
    resolveConflicts: vi.fn(),
    revealConflictCredentials: vi.fn(),
  },
}))

it('offers a separate development preview while the account and sync page keep their real state', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useAccountStore.setState({ status: { loggedIn: false, sessionState: 'anonymous', syncEnabled: false } })
  useSyncStore.setState(useSyncStore.getInitialState(), true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <SyncPanel />
        </TooltipProvider>,
      ),
    )
    expect(host.textContent).toContain('登录后同步条目')
    expect(host.textContent).not.toContain('【MOCK】')
    const before = JSON.stringify(useSyncStore.getState())
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent === '预览合并工作台（Mock）')!
        .click(),
    )
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('合并工作台 · Mock')
    expect(host.textContent).not.toContain('【MOCK】')
    expect(JSON.stringify(useSyncStore.getState())).toBe(before)
    expect(useAccountStore.getState().status?.loggedIn).toBe(false)
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭合并工作台"]')!.click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(JSON.stringify(useSyncStore.getState())).toBe(before)
    expect(syncApi.resolveConflicts).not.toHaveBeenCalled()
    expect(syncApi.revealConflictCredentials).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllEnvs()
  }
})
