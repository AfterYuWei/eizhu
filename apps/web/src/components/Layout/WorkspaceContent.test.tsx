// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceContent } from './WorkspaceContent'
import { resetWorkspaceView, useWorkspaceViewStore } from '@/store/workspaceView'
import { useSessionStore } from '@/store/session'
import type { TransferTask } from '@/types/sftp'

vi.mock('@/api/profile', () => ({ profileApi: { list: async () => [] } }))
vi.mock('@/components/Terminal', () => ({ TerminalView: () => <textarea aria-label="终端缓冲" /> }))
vi.mock('./ConnectionHome', () => ({ ConnectionHome: () => <p>连接首页</p> }))
vi.mock('@/components/Sftp/SftpView', () => ({ SftpView: () => <input aria-label="SFTP 状态" /> }))
vi.mock('@/components/Vault/VaultView', () => ({ VaultView: () => <input aria-label="密钥状态" /> }))
let root: Root
let host: HTMLDivElement
beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await resetWorkspaceView()
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  await resetWorkspaceView()
  host.remove()
})

it('无终端也可打开工具页，首次按需挂载、重复切换保留唯一 DOM 与传输状态', async () => {
  await act(async () => root.render(<WorkspaceContent onAddServer={() => {}} />))
  expect(host.textContent).toBe('连接首页')
  expect(host.querySelector('input')).toBeNull()
  await act(async () => { await useWorkspaceViewStore.getState().openSftp(); await vi.dynamicImportSettled() })
  const sftp = host.querySelector<HTMLInputElement>('[aria-label="SFTP 状态"]')!
  sftp.value = '目录和选择状态'
  const store = useWorkspaceViewStore.getState().sftpStore!
  const tasks: TransferTask[] = [{ id: 'transfer-1', file_name: 'file.txt', direction: 'upload', size: 100, transferred: 20, status: 'transferring', speed: 10, started_at: 0 }]
  store.setState({ transfers: tasks })
  await act(async () => { useWorkspaceViewStore.getState().openVault(); await vi.dynamicImportSettled() })
  const vault = host.querySelector<HTMLInputElement>('[aria-label="密钥状态"]')!
  vault.value = '密钥筛选'
  expect(host.querySelector<HTMLElement>('#workspace-sftp')!.hidden).toBe(true)
  expect(host.querySelector('#workspace-sftp')!.hasAttribute('inert')).toBe(true)
  let id!: string
  await act(async () => { id = useSessionStore.getState().openDraftTab() })
  const terminal = host.querySelector<HTMLTextAreaElement>('textarea')!
  terminal.value = '终端输入'
  for (let i = 0; i < 2; i++) {
    await act(async () => useWorkspaceViewStore.getState().openSftp())
    await act(async () => useWorkspaceViewStore.getState().openVault())
    await act(async () => useSessionStore.getState().setActiveTab(id))
  }
  expect(host.querySelectorAll('[aria-label="SFTP 状态"]')).toHaveLength(1)
  expect(host.querySelector('[aria-label="SFTP 状态"]')).toBe(sftp)
  expect(host.querySelector('[aria-label="密钥状态"]')).toBe(vault)
  expect(host.querySelector('textarea')).toBe(terminal)
  expect([sftp.value, vault.value, terminal.value]).toEqual(['目录和选择状态', '密钥筛选', '终端输入'])
  expect(store.getState().transfers).toBe(tasks)
})
