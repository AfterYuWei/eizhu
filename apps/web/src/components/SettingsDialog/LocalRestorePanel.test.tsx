// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LocalRestorePanel } from './LocalRestorePanel'
const mocks = vi.hoisted(() => ({
  prepareRestore: vi.fn(),
  previewSafety: vi.fn(),
  safetyVersions: vi.fn(),
  applyRestore: vi.fn(),
  refresh: vi.fn(),
  vaultRefresh: vi.fn(),
  restored: vi.fn(),
}))
vi.mock('@/lib/bridge', () => ({ bridge: () => ({ backup: mocks }) }))
vi.mock('@/store/profile', () => ({ useProfileStore: { getState: () => ({ refreshAll: mocks.refresh }) } }))
vi.mock('@/store/vault', () => ({ useVaultStore: { getState: () => ({ fetchList: mocks.vaultRefresh }) } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.resetAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.safetyVersions.mockResolvedValue([])
  const counts = { added: 1, changed: 2, unchanged: 3, removedInReplace: 4 }
  mocks.prepareRestore.mockResolvedValue({
    token: 'frozen-preview',
    source: { kind: 'file', name: '合成备份.eizhubackup' },
    stats: {},
    changes: { groups: counts, vault: counts, profiles: counts, snippets: counts },
    credentialMode: 'encrypted',
    exportedAt: '2026-10-20',
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === label)!
async function renderPreview() {
  await act(async () =>
    root.render(
      <LocalRestorePanel
        source={{ name: '合成备份', path: 'opaque-reference' }}
        password="中文密码"
        onRestored={mocks.restored}
      />,
    ),
  )
  await act(async () => button('预览完整恢复').click())
}
it('cancelling the authoritative file preview never applies or refreshes business data', async () => {
  await renderPreview()
  expect(document.querySelector('table tbody tr')?.textContent).toBe('分组1234')
  expect(document.body.textContent).toContain('合成备份.eizhubackup')
  await act(async () => button('取消').click())
  expect(mocks.applyRestore).not.toHaveBeenCalled()
  expect(mocks.restored).not.toHaveBeenCalled()
})
it('replace uses the frozen token and refreshes only after a successful commit', async () => {
  await renderPreview()
  mocks.applyRestore.mockRejectedValueOnce(new Error('请重新预览'))
  await act(async () => button('替换当前空间').click())
  expect(mocks.restored).not.toHaveBeenCalled()
  expect(mocks.refresh).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  mocks.applyRestore.mockResolvedValueOnce(undefined)
  await act(async () => button('替换当前空间').click())
  expect(mocks.applyRestore).toHaveBeenLastCalledWith({ token: 'frozen-preview', mode: 'replace' })
  expect(mocks.restored).toHaveBeenCalledOnce()
  expect(mocks.refresh).toHaveBeenCalledOnce()
  expect(mocks.vaultRefresh).toHaveBeenCalledOnce()
})
