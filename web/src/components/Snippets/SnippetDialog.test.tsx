// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SnippetDialog } from './SnippetDialog'
import { snippetApi } from '@/api/snippet'
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
