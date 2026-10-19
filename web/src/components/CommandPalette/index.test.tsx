// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { CommandPalette } from './index'
import { useProfileStore } from '@/store/profile'
import { useSessionStore } from '@/store/session'
import { useVaultStore } from '@/store/vault'
import { vaultApi } from '@/api/vault'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import type { Profile } from '@/types/profile'
import type { VaultItem } from '@/types/vault'

vi.mock('@/api/vault', () => ({ vaultApi: { list: vi.fn() } }))
const profile: Profile = { id: 'p', name: '生产环境', host: 'example.test', port: 22, username: 'root', auth_type: 'agent', proxy: { type: 'direct' }, tags: [], options: '{}', note: '', sort_order: 0, created_at: '', updated_at: '' }
const vault: VaultItem = { id: 'v', name: '部署密钥', type: 'private_key', username: '', remark: '', fingerprint: '', ref_count: 0, has_passphrase: false, created_at: '', updated_at: '' }
let host: HTMLDivElement
let root: Root
const close = vi.fn()

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.resetAllMocks()
  useProfileStore.setState({ profiles: [profile] })
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useVaultStore.setState(useVaultStore.getInitialState(), true)
  vi.mocked(vaultApi.list).mockResolvedValue([vault])
  setWorkspaceGeneration(1)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })
async function render() { await act(async () => root.render(<CommandPalette open onClose={close} />)) }
async function query(value: string) {
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('统一显示服务器、密钥、命令，选择服务器复用已有会话', async () => {
  const open = vi.fn()
  useSessionStore.setState({ tabs: [{ id: 'existing', kind: 'terminal', profileId: 'p', profileName: profile.name, status: 'disconnected', sessionId: null }], activeTabId: null, openTab: open })
  await render()
  expect(document.querySelector('[role="group"][aria-label="服务器"]')).not.toBeNull()
  expect(document.querySelector('[role="group"][aria-label="密钥"]')).not.toBeNull()
  expect(document.querySelector('[role="group"][aria-label="操作命令"]')).not.toBeNull()
  await act(async () => (document.querySelector('[role="group"][aria-label="服务器"] button') as HTMLButtonElement).click())
  expect(useSessionStore.getState().activeTabId).toBe('existing')
  expect(open).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
})

it('密钥搜索定位确切条目，并清除此前的类型筛选', async () => {
  useVaultStore.setState({ filterType: 'password' })
  await render()
  await act(async () => (document.querySelector('[role="group"][aria-label="密钥"] button') as HTMLButtonElement).click())
  expect(useVaultStore.getState()).toMatchObject({ filterType: 'all', searchQuery: vault.name, focusedItemId: vault.id })
  expect(useSessionStore.getState().tabs[0].kind).toBe('vault')
})

it('快速换词与工作区切换后忽略旧密钥响应', async () => {
  let resolveOld!: (items: VaultItem[]) => void
  vi.mocked(vaultApi.list).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
  await render()
  await query('新关键词')
  await act(async () => resolveOld([{ ...vault, id: 'old', name: '旧结果' }]))
  expect(document.body.textContent).not.toContain('旧结果')
  let resolveWorkspace!: (items: VaultItem[]) => void
  vi.mocked(vaultApi.list).mockImplementationOnce(() => new Promise((resolve) => { resolveWorkspace = resolve }))
  await query('另一个关键词')
  await act(async () => { setWorkspaceGeneration(2); resolveWorkspace([{ ...vault, name: '旧工作区密钥' }]) })
  expect(document.body.textContent).not.toContain('旧工作区密钥')
})

it('密钥搜索失败时服务器搜索和键盘回车仍可使用', async () => {
  vi.mocked(vaultApi.list).mockRejectedValue(new Error('offline'))
  const open = vi.fn()
  useSessionStore.setState({ openTab: open })
  await render()
  await query('example.test')
  expect(document.body.textContent).toContain('密钥搜索暂不可用')
  await act(async () => document.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(open).toHaveBeenCalledWith('p', profile.name, profile.host, 22, 'root', undefined)
})

it('异步插入密钥结果时保留已选中的操作命令', async () => {
  let resolve!: (items: VaultItem[]) => void
  vi.mocked(vaultApi.list).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  await render()
  await act(async () => document.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  const label = document.querySelector('[role="option"][aria-selected="true"]')!.textContent
  await act(async () => resolve([vault]))
  expect(document.querySelector('[role="option"][aria-selected="true"]')!.textContent).toBe(label)
})
