// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArchivePanel } from './ArchivePanel'
import { Tabs } from '@/components/ui/tabs'
import { archiveApi } from '@/api/archive'
import { toast } from 'sonner'
import type { BackupSettings } from '@/types/backup'
vi.mock('@/api/archive', () => ({
  archiveApi: {
    settings: vi.fn(),
    status: vi.fn(),
    selectDirectory: vi.fn(),
    updateSettings: vi.fn(),
    backupNow: vi.fn(),
  },
}))
vi.mock('./ProviderForm', () => ({ ProviderSection: () => <div>第三方云目标</div> }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
let host: HTMLDivElement, root: Root
const settings: BackupSettings = {
  directory: '/selected/backup',
  backup_password_set: true,
  scheduled_enabled: false,
  scheduled_interval_hours: 24,
  scheduled_daily_time: '',
  auto_backup_enabled: false,
  change_debounce_seconds: 10,
}
beforeEach(() => {
  vi.resetAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.mocked(archiveApi.settings).mockResolvedValue(settings)
  vi.mocked(archiveApi.status).mockResolvedValue({
    status: 'idle',
    last_backup_at: null,
    last_backup_path: null,
    last_error: null,
    providers: [],
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
const render = () =>
  act(async () =>
    root.render(
      <Tabs defaultValue="backup">
        <ArchivePanel />
      </Tabs>,
    ),
  )
it('只展示自动备份、目录及云目标，不展示版本、恢复或历史控件', async () => {
  await render()
  expect(host.textContent).toContain('/selected/backup')
  expect(host.textContent).toContain('第三方云目标')
  for (const text of ['版本恢复', '本地版本', '保留版本数', '安全快照', '提交最新版本'])
    expect(host.textContent).not.toContain(text)
  await act(async () => button('选择目录').click())
  expect(archiveApi.selectDirectory).toHaveBeenCalledOnce()
})
it('没有本地目录时禁用自动备份及立即备份', async () => {
  vi.mocked(archiveApi.settings).mockResolvedValue({ ...settings, directory: null })
  await render()
  expect(button('立即备份').disabled).toBe(true)
  expect(host.querySelector('#backup-auto')!.hasAttribute('disabled')).toBe(true)
})
it('云目标上传失败明确告知本地文件已保存', async () => {
  vi.mocked(archiveApi.backupNow).mockResolvedValue({
    path: '/selected/backup/new.eizhubackup',
    uploaded: 1,
    failed: 1,
  })
  await render()
  await act(async () => button('立即备份').click())
  expect(toast.warning).toHaveBeenCalledWith('本地备份已保存，部分云目标上传失败')
  expect(toast.success).not.toHaveBeenCalled()
})
