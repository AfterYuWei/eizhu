// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SyncConflictMock from './SyncConflictMock'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAccountStore } from '@/store/account'
import { useProfileStore } from '@/store/profile'
import { useSyncStore } from '@/store/sync'
import { useVaultStore } from '@/store/vault'

let host: HTMLDivElement, root: Root
const close = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useAccountStore.setState({ status: { loggedIn: false, sessionState: 'anonymous', syncEnabled: false } })
  useProfileStore.setState({
    groups: [
      {
        id: 'real-group',
        name: '原有分组',
        icon: 'folder',
        sort_order: 0,
        created_at: '2026-11-05T00:00:00Z',
      },
    ],
    profiles: [],
    searchQuery: '原有筛选',
  })
  useVaultStore.setState({ items: [], searchQuery: '原有凭据筛选' })
  useSyncStore.setState({
    status: {
      status: 'paused',
      pendingCount: 3,
      conflictCount: 1,
      cursor: 9,
      initialized: true,
      unlocked: true,
      lastConfirmed: null,
      lastError: '',
      items: [],
    },
    conflicts: [
      {
        itemType: 'snippet',
        itemId: 'real-conflict',
        name: '原有冲突',
        reason: 'concurrent_edit',
        localRevision: 9,
        remoteRevision: 8,
        localDeleted: false,
        remoteDeleted: false,
        local: { content: 'original local' },
        remote: { content: 'original cloud' },
      },
    ],
    focusItem: { type: 'snippet', id: 'real-conflict' },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  delete window.eizhu
  vi.restoreAllMocks()
})
const click = async (label: string) =>
  act(async () => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === label || button.getAttribute('aria-label') === label,
    )
    expect(button).toBeDefined()
    button!.click()
  })

it('keeps viewing, staging and simulated application inside the workbench without IPC, network, storage or shared-state changes', async () => {
  const bridgeRead = vi.fn(() => {
    throw new Error('Mock must not access the desktop bridge')
  })
  Object.defineProperty(window, 'eizhu', { configurable: true, get: bridgeRead })
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Mock must not access the network'))
  const persist = vi.spyOn(Storage.prototype, 'setItem')
  const before = JSON.stringify([
    useAccountStore.getState(),
    useProfileStore.getState(),
    useVaultStore.getState(),
    useSyncStore.getState(),
  ])
  const unchanged = () => {
    expect(
      JSON.stringify([
        useAccountStore.getState(),
        useProfileStore.getState(),
        useVaultStore.getState(),
        useSyncStore.getState(),
      ]),
    ).toBe(before)
    expect(bridgeRead).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  }
  await act(async () =>
    root.render(
      <TooltipProvider>
        <SyncConflictMock onOpenChange={close} />
      </TooltipProvider>,
    ),
  )
  const dialog = () => document.querySelector('[role="dialog"]')!
  expect(dialog().textContent).toContain('合并工作台 · Mock')
  expect(dialog().textContent).not.toContain('原有冲突')
  expect(dialog().querySelectorAll('.sync-conflict-list button')).toHaveLength(6)
  await act(async () =>
    [...dialog().querySelectorAll<HTMLButtonElement>('.sync-conflict-list button')]
      .find((b) => b.textContent?.includes('运维密码'))!
      .click(),
  )
  await click('查看双方凭据')
  expect(dialog().textContent).toContain('mock-local-password')
  expect(dialog().textContent).toContain('mock-cloud-password')
  unchanged()
  await act(async () => dialog().querySelector<HTMLButtonElement>('.sync-conflict-list button')!.click())
  expect(dialog().textContent).not.toContain('mock-local-password')
  for (let i = 0; i < 6; i++) {
    const deletion = dialog().querySelector<HTMLButtonElement>('.sync-conflict-deletion-option')
    if (deletion) await act(async () => deletion.click())
    else await click('整条用本机')
    await click('暂存此项')
  }
  await click('预览已选（6）')
  unchanged()
  expect(dialog().textContent).not.toContain('应用至本机')
  await click('模拟应用')
  expect(dialog().textContent).toContain('本次冲突已处理')
  unchanged()
  await click('完成')
  expect(close).toHaveBeenCalledWith(false)
  await act(async () => root.render(null))
  await act(async () =>
    root.render(
      <TooltipProvider>
        <SyncConflictMock onOpenChange={close} />
      </TooltipProvider>,
    ),
  )
  expect(dialog().querySelectorAll('.sync-conflict-list button')).toHaveLength(6)
  unchanged()
})
