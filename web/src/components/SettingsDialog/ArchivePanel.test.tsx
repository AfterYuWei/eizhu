// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArchivePanel } from './ArchivePanel'
import { archiveApi } from '@/api/archive'
import type { BackupSettings, RestorePreview } from '@/types/backup'
vi.mock('@/api/archive', () => ({ archiveApi: { settings: vi.fn(), status: vi.fn(), versions: vi.fn(), safetyVersions: vi.fn(), previewVersion: vi.fn(), events: vi.fn(), applyRestore: vi.fn() } }))
vi.mock('./ProviderForm', () => ({ ProviderSection: () => null }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.resetAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.mocked(archiveApi.settings).mockResolvedValue({ backup_password_set: true, scheduled_enabled: false, auto_backup_enabled: false, local_keep_versions: 20 } as BackupSettings)
  vi.mocked(archiveApi.status).mockResolvedValue({ status: 'idle', local_latest: null, cloud_latest: {}, providers: [], conflict: null, last_sync_at: null })
  vi.mocked(archiveApi.versions).mockResolvedValue([{ id: 'one', version: 9, hash: '', size: 12, origin: 'manual', synced_to: [], created_at: '2026-10-02' }])
  vi.mocked(archiveApi.safetyVersions).mockResolvedValue([])
  const counts = { added: 1, changed: 2, unchanged: 3, removedInReplace: 4 }
  vi.mocked(archiveApi.previewVersion).mockResolvedValue({ token: 'one', source: { kind: 'local_version', version: 9 }, stats: { groups: 6, profiles: 6, vault: 6, snippets: 6 }, changes: { groups: counts, profiles: counts, vault: counts, snippets: counts }, credentialMode: 'encrypted', exportedAt: '2026-10-02' } satisfies RestorePreview)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
it('shows the authoritative source and change counts; cancelling never applies a restore', async () => {
  await act(async () => root.render(<ArchivePanel />))
  const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === label)!
  await act(async () => button('恢复预览').click())
  expect(document.body.textContent).toContain('本地版本 v9')
  expect(document.body.textContent).toContain('替换时移除')
  expect(document.querySelector('table tbody tr')?.textContent).toBe('分组1234')
  await act(async () => button('取消').click())
  expect(archiveApi.applyRestore).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
})
