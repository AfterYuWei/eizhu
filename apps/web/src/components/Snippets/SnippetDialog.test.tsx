// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SnippetDialog } from './SnippetDialog'
import { snippetApi } from '@/api/snippet'
import { useSessionStore } from '@/store/session'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import { registerTerminalActions } from '@/lib/terminalActions'
vi.mock('@/api/snippet', () => ({ snippetApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
let host: HTMLDivElement, root: Root
const snippet = { id: 'one', name: '磁盘空间', content: 'df -h', description: '检查磁盘', tags: ['linux'], is_global: true, created_at: '', updated_at: '' }
beforeEach(() => {
  vi.resetAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.mocked(snippetApi.list).mockResolvedValue([snippet])
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === label)!
const inputValue = async (selector: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(selector)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('列表选择与搜索仅展示对应片段详情，切换条目重置删除确认', async () => {
  vi.mocked(snippetApi.list).mockResolvedValue([snippet, { ...snippet, id: 'two', name: '查看目录', description: '列出目录', content: 'ls -la', tags: ['files'] }])
  await act(async () => root.render(<SnippetDialog open onOpenChange={() => {}} />))
  expect(document.querySelector('.snippet-code')?.textContent).toBe('df -h')
  await act(async () => button('删除').click())
  await act(async () => document.querySelectorAll<HTMLButtonElement>('.snippet-list-item')[1].click())
  expect(document.querySelector('.snippet-code')?.textContent).toBe('ls -la')
  expect(button('确认删除')).toBeUndefined()
  expect(snippetApi.delete).not.toHaveBeenCalled()
  await inputValue('[aria-label="搜索片段"]', 'linux')
  expect(document.querySelectorAll('.snippet-list-item')).toHaveLength(1)
  expect(document.querySelector('.snippet-code')?.textContent).toBe('df -h')
  await inputValue('[aria-label="搜索片段"]', '没有匹配')
  expect(document.querySelector('.snippet-code')).toBeNull()
  expect(document.body.textContent).toContain('暂无匹配片段')
})
it('搜索状态下新建后定位到保存的片段', async () => {
  vi.mocked(snippetApi.create).mockResolvedValue({ ...snippet, id: 'new', name: '新片段', content: 'pwd' })
  await act(async () => root.render(<SnippetDialog open onOpenChange={() => {}} />))
  await inputValue('[aria-label="搜索片段"]', 'linux')
  await act(async () => button('新建片段').click())
  await inputValue('#snippet-name', '新片段')
  await act(async () => {
    const textarea = document.querySelector<HTMLTextAreaElement>('#snippet-content')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'pwd')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => button('保存').click())
  expect(snippetApi.create).toHaveBeenCalledWith({ name: '新片段', content: 'pwd', description: '', tags: [] })
  expect(document.querySelector('.snippet-detail h2')?.textContent).toBe('新片段')
  expect(document.querySelector<HTMLInputElement>('[aria-label="搜索片段"]')?.value).toBe('')
})
it('读取失败提供重试，恢复后显示详情', async () => {
  vi.mocked(snippetApi.list).mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue([snippet])
  await act(async () => root.render(<SnippetDialog open onOpenChange={() => {}} />))
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('片段读取失败')
  expect(document.querySelector('.snippet-code')).toBeNull()
  await act(async () => button('重试').click())
  expect(document.querySelector('.snippet-code')?.textContent).toBe('df -h')
})
it('retains the editing form after a failed update and saves through existing CRUD', async () => {
  vi.mocked(snippetApi.update).mockRejectedValueOnce(new Error('保存失败')).mockResolvedValue(snippet)
  await act(async () => root.render(<SnippetDialog open onOpenChange={() => {}} />))
  await act(async () => button('编辑').click())
  await act(async () => button('保存').click())
  expect(document.querySelector<HTMLTextAreaElement>('#snippet-content')?.value).toBe('df -h')
  await act(async () => button('保存').click())
  expect(snippetApi.update).toHaveBeenLastCalledWith('one', { name: '磁盘空间', content: 'df -h', description: '检查磁盘', tags: ['linux'] })
  expect(document.querySelector('#snippet-content')).toBeNull()
})
it('deletes only after the second explicit selection and removes the accepted row', async () => {
  vi.mocked(snippetApi.delete).mockResolvedValue(undefined)
  await act(async () => root.render(<SnippetDialog open onOpenChange={() => {}} />))
  await act(async () => button('删除').click())
  expect(snippetApi.delete).not.toHaveBeenCalled()
  await act(async () => button('确认删除').click())
  expect(snippetApi.delete).toHaveBeenCalledWith('one')
  expect(document.body.textContent).toContain('暂无匹配片段')
})

it('共享预览保留管理界面的明确执行入口', async () => {
  setWorkspaceGeneration(1)
  useSessionStore.setState({ activeTabId: 't', tabs: [{ id: 't', profileId: 'p', profileName: '服务器', sessionId: 's', status: 'connected' }] })
  const insert = vi.fn()
  const unregister = registerTerminalActions('t', { insert, focus: vi.fn(), reconnect: vi.fn(), search: vi.fn(), safeMultiline: () => true })
  try {
    await act(async () => root.render(<SnippetDialog open onOpenChange={() => {}} />))
    await act(async () => button('预览与执行').click())
    expect(insert).not.toHaveBeenCalled()
    await act(async () => button('明确执行这段命令').click())
    expect(insert).toHaveBeenCalledExactlyOnceWith('df -h', true)
    expect(document.body.textContent).not.toContain('沿用账号同步')
  } finally { unregister() }
})
