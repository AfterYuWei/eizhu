// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useProfileStore } from '@/store/profile'
import { useSessionStore } from '@/store/session'
import type { Group } from '@/types/group'
import type { Profile } from '@/types/profile'
import { ConnectionPicker } from './ConnectionPicker'

const group = (id: string, name: string, parent_id?: string): Group => ({ id, name, parent_id, icon: 'folder', sort_order: 0, created_at: '' })
const server = (id: string, group_id?: string): Profile => ({ id, name: `服务器 ${id}`, host: `${id}.example.test`, port: 22, username: 'deploy', group_id, auth_type: 'password', proxy: { type: 'direct' }, tags: [], options: '{}', note: '', sort_order: 0, created_at: '', updated_at: '' })
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useProfileStore.setState({ groups: [group('prod', 'Prod'), group('node', 'Node'), group('east', '华东', 'prod'), group('empty', '空分组')], profiles: [server('east', 'east'), server('node', 'node'), server('prod', 'prod'), server('orphan', 'missing'), server('loose')] })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useProfileStore.setState({ profiles: [], groups: [] })
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  vi.restoreAllMocks()
})
const render = async () => act(async () => root.render(<ConnectionPicker tabId="draft-target" />))
const search = async (value: string) => act(async () => {
  const input = host.querySelector('input')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const section = (name: string) => host.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!

it('沿用分组顺序与父子层级，父组计入子组服务器，未知归属只出现于未分组', async () => {
  await render()
  expect([...host.querySelectorAll('.connection-picker-list > section')].map((node) => node.getAttribute('aria-label'))).toEqual(['Prod', 'Node', '未分组'])
  expect(section('Prod').querySelector('.connection-picker-count')?.textContent).toBe('2')
  expect(section('Prod').contains(section('Prod / 华东'))).toBe(true)
  expect(section('Prod / 华东').querySelector('.connection-picker-count')?.textContent).toBe('1')
  expect(section('未分组').querySelectorAll('.connection-picker-server')).toHaveLength(2)
  expect(host.querySelectorAll('.connection-picker-server')).toHaveLength(5)
  expect(section('Prod').querySelector('.connection-picker-server')?.textContent).toContain('服务器 prod')
})

it('搜索分组路径会保留祖先与所属服务器，展开已折叠结果并显示匹配数量', async () => {
  await render()
  const toggle = section('Prod').querySelector<HTMLButtonElement>('.connection-picker-group-toggle')!
  const content = host.querySelector<HTMLElement>(`[id="${toggle.getAttribute('aria-controls')}"]`)!
  await act(async () => toggle.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(content.hidden).toBe(true)
  await search('PROD')
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(content.hidden).toBe(false)
  expect(host.querySelectorAll('.connection-picker-server')).toHaveLength(2)
  expect(host.querySelectorAll('.connection-picker-list > section')).toHaveLength(1)
  await search('Prod / 华东')
  expect(host.querySelectorAll('.connection-picker-server')).toHaveLength(1)
  expect(section('Prod').querySelector('.connection-picker-count')?.textContent).toBe('1 / 2')
  expect(section('Prod / 华东').textContent).toContain('服务器 east')
  await search('未分组')
  expect(host.querySelectorAll('.connection-picker-server')).toHaveLength(2)
  expect(host.querySelector('.connection-picker-list > section')?.getAttribute('aria-label')).toBe('未分组')
})

it('地址与用户名搜索继续生效，选择卡片复用当前草稿，空结果保留提示', async () => {
  const openTab = vi.fn().mockResolvedValue('draft-target')
  useSessionStore.setState({ openTab })
  await render()
  await search('deploy')
  expect(host.querySelectorAll('.connection-picker-server')).toHaveLength(5)
  await search('east.example.test')
  const card = host.querySelector<HTMLButtonElement>('.connection-picker-server')!
  await act(async () => { card.focus(); card.click() })
  expect(document.activeElement).toBe(card)
  expect(card.getAttribute('aria-label')).toContain('Prod / 华东')
  expect(openTab).toHaveBeenCalledExactlyOnceWith('east', '服务器 east', 'east.example.test', 22, 'deploy', 'draft-target')
  await search('不存在的关键词')
  expect(host.querySelector('[role="status"]')?.textContent).toContain('未找到匹配')
})
