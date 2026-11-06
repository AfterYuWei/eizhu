// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { Snippet } from '@/types/snippet'
import { setWorkspaceGeneration } from './workspaceScope'
import { findQuickSnippets, recentSnippetIds, recordSnippetUse, resetSnippetQuickAccess, suppressHeldSnippetEnter } from './snippetQuickAccess'

const snippet = (id: string, name: string, content = 'pwd', description = '', tags: string[] = []): Snippet => ({
  id, name, content, description, tags, is_global: false, created_at: '', updated_at: '',
})
beforeEach(() => { setWorkspaceGeneration(1); resetSnippetQuickAccess() })
afterEach(() => window.dispatchEvent(new Event('blur')))

it('名称匹配优先，忽略大小写并检索标签、描述、命令，空查询按最近使用和名称排序', () => {
  const items = [snippet('z', 'Zulu'), snippet('a', 'Alpha', 'DOCKER ps'), snippet('d', 'Docker'), snippet('t', 'Beta', 'pwd', '', ['docker']), snippet('n', 'Gamma', 'pwd', 'Docker 服务')]
  expect(findQuickSnippets(items, ' DOCKER ', ['t', 'a']).map((s) => s.id)).toEqual(['d', 't', 'a', 'n'])
  expect(findQuickSnippets(items, '', ['z', 'a']).map((s) => s.id)).toEqual(['z', 'a', 't', 'd', 'n'])
  expect(findQuickSnippets(items, '不存在', [])).toEqual([])
  expect(items.map((s) => s.id)).toEqual(['z', 'a', 'd', 't', 'n'])
})

it('最近使用只保存 20 个去重 ID，读取副本且工作空间变化清空', () => {
  for (let index = 0; index < 23; index++) recordSnippetUse(`s${index}`)
  recordSnippetUse('s20')
  expect(recentSnippetIds()).toHaveLength(20)
  expect(recentSnippetIds().slice(0, 3)).toEqual(['s20', 's22', 's21'])
  expect(recentSnippetIds()).not.toContain('s2')
  recentSnippetIds().push('外部修改')
  expect(recentSnippetIds()).not.toContain('外部修改')
  setWorkspaceGeneration(2)
  expect(recentSnippetIds()).toEqual([])
})

it('删除的片段不出现在结果中，同名片段使用稳定顺序', () => {
  const items = [snippet('b', '磁盘空间'), snippet('a', '磁盘空间')]
  expect(findQuickSnippets(items, '', ['已删除']).map((s) => s.id)).toEqual(['a', 'b'])
})

it('插入后按住 Enter 不透传，松开后新的 Enter 正常交给终端', () => {
  const input = document.createElement('textarea')
  document.body.append(input)
  let enters = 0
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') enters++ })
  suppressHeldSnippetEnter()
  const repeated = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
  input.dispatchEvent(repeated)
  expect(repeated.defaultPrevented).toBe(true)
  expect(enters).toBe(0)
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  expect(enters).toBe(1)
  suppressHeldSnippetEnter()
  window.dispatchEvent(new Event('blur'))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }))
  expect(enters).toBe(2)
  input.remove()
})
