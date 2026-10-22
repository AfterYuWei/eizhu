// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VaultView } from './VaultView'
import { useVaultStore } from '@/store/vault'
import { useWorkspaceViewStore } from '@/store/workspaceView'
import type { VaultItem } from '@/types/vault'

const api = vi.hoisted(() => ({ list: vi.fn(), reveal: vi.fn(), references: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), generateKeyPair: vi.fn() }))
const copy = vi.hoisted(() => vi.fn())
vi.mock('@/api/vault', () => ({ vaultApi: api }))
vi.mock('@/api/profile', () => ({ profileApi: { list: async () => [] } }))
vi.mock('@/lib/clipboard', () => ({ writeSensitiveClipboardText: copy, writeClipboardText: vi.fn() }))
const first: VaultItem = { id: 'a', name: '密钥甲', type: 'private_key', username: '', remark: '', fingerprint: '', ref_count: 1, has_passphrase: false, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' }
const second: VaultItem = { ...first, id: 'b', name: '密钥乙', ref_count: 0 }
let host: HTMLDivElement
let root: Root
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent?.trim() === text)! }
function row(name: string) { return [...host.querySelectorAll<HTMLButtonElement>('[data-vault-item]')].find(el => el.textContent?.includes(name))! }
function inputValue(input: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  api.list.mockResolvedValue([first, second])
  api.reveal.mockResolvedValue({ private_key: '合成私钥', public_key: '合成公钥', passphrase: '合成口令' })
  api.references.mockResolvedValue([{ id: 'p', name: '测试服务器' }])
  api.update.mockResolvedValue(first)
  copy.mockResolvedValue(undefined)
  useVaultStore.setState(useVaultStore.getInitialState(), true)
  useWorkspaceViewStore.setState({ activePage: 'vault', vaultOpened: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function render() { await act(async () => root.render(<VaultView />)) }

it('浏览摘要不读取密钥；复制使用敏感剪贴板，隐藏与离开工具页清理显示内容', async () => {
  await render()
  expect(api.reveal).not.toHaveBeenCalled()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="复制私钥"]')!.click())
  expect(copy).toHaveBeenCalledWith('合成私钥')
  expect(host.textContent).not.toContain('合成私钥')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="显示私钥"]')!.click())
  expect(host.textContent).toContain('合成私钥')
  expect(host.textContent).not.toContain('合成公钥')
  expect(JSON.stringify(useVaultStore.getState())).not.toContain('合成私钥')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="隐藏私钥"]')!.click())
  expect(host.textContent).not.toContain('合成私钥')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="显示私钥"]')!.click())
  await act(async () => useWorkspaceViewStore.setState({ activePage: 'terminal' }))
  expect(host.textContent).not.toContain('合成私钥')
  await act(async () => useWorkspaceViewStore.setState({ activePage: 'vault' }))
  expect(host.textContent).not.toContain('合成私钥')
})

it('切换凭据后丢弃旧的密钥读取响应；引用由当前凭据按需加载', async () => {
  let resolve!: (value: { private_key: string }) => void
  api.reveal.mockImplementationOnce(() => new Promise(accept => { resolve = accept }))
  await render()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="显示私钥"]')!.click())
  await act(async () => row('密钥乙').click())
  await act(async () => resolve({ private_key: '过期私钥' }))
  expect(host.querySelector('h2')?.textContent).toBe('密钥乙')
  expect(host.textContent).not.toContain('过期私钥')
  expect(api.references).not.toHaveBeenCalled()
  await act(async () => host.querySelector<HTMLButtonElement>('.vault-reference-toggle')!.click())
  expect(api.references).toHaveBeenCalledWith('b')
  expect(host.textContent).toContain('测试服务器')
})

it('行内编辑先读取原内容；未保存时切换需确认，保存保留原私钥和公钥', async () => {
  await render()
  await act(async () => button('编辑').click())
  const name = host.querySelector<HTMLInputElement>('input[id$="-name"]')!
  await act(async () => inputValue(name, '已修改名称'))
  await act(async () => row('密钥乙').click())
  expect(document.body.textContent).toContain('放弃未保存的修改？')
  await act(async () => button('继续编辑').click())
  expect(host.querySelector<HTMLInputElement>('input[id$="-name"]')!.value).toBe('已修改名称')
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(api.update).toHaveBeenCalledWith('a', expect.objectContaining({ name: '已修改名称', private_key: '合成私钥', public_key: '合成公钥', passphrase: '合成口令', username: '' }))
  expect(host.querySelector('form')).toBeNull()
  expect(document.body.textContent).not.toContain('放弃未保存的修改？')
})

it('原凭据读取失败时禁止提交，重试后才允许编辑', async () => {
  api.reveal.mockRejectedValueOnce(new Error('读取失败'))
  await render()
  await act(async () => button('编辑').click())
  expect(host.textContent).toContain('原有内容已保留')
  expect(button('保存').disabled).toBe(true)
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(api.update).not.toHaveBeenCalled()
  await act(async () => button('重试').click())
  const name = host.querySelector<HTMLInputElement>('input[id$="-name"]')!
  expect(name.matches(':disabled')).toBe(false)
  await act(async () => inputValue(name, '重试后修改'))
  expect(button('保存').disabled).toBe(false)
})

it('重新新建时先确认放弃未保存内容，再重置表单', async () => {
  await render()
  await act(async () => button('新建凭据').click())
  await act(async () => inputValue(host.querySelector<HTMLInputElement>('input[id$="-name"]')!, '未保存的名称'))
  await act(async () => button('新建凭据').click())
  expect(document.body.textContent).toContain('放弃未保存的修改？')
  await act(async () => button('放弃修改').click())
  expect(host.querySelector<HTMLInputElement>('input[id$="-name"]')!.value).toBe('')
  expect(api.create).not.toHaveBeenCalled()
})

it('筛选期间新建凭据后清除筛选并选中新条目', async () => {
  useVaultStore.setState({ searchQuery: '密钥', filterType: 'private_key' })
  await render()
  await act(async () => button('新建凭据').click())
  const created: VaultItem = { ...first, id: 'created', name: '新密码', type: 'password', username: 'deploy', ref_count: 0 }
  api.create.mockResolvedValue(created)
  api.list.mockResolvedValue([created, first, second])
  await act(async () => {
    inputValue(host.querySelector<HTMLInputElement>('input[id$="-name"]')!, '新密码')
    inputValue(host.querySelector<HTMLInputElement>('input[id$="-username"]')!, 'deploy')
    inputValue(host.querySelector<HTMLInputElement>('[aria-label="密码"]')!, '合成密码')
  })
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(useVaultStore.getState().filterType).toBe('all')
  expect(useVaultStore.getState().searchQuery).toBe('')
  expect(host.querySelector('h2')?.textContent).toBe('新密码')
  expect(host.querySelector<HTMLButtonElement>('.vault-toolbar-actions button')!.disabled).toBe(false)
})
