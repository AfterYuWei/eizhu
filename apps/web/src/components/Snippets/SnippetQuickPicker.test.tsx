// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { snippetApi } from '@/api/snippet'
import type { Snippet } from '@/types/snippet'
import { snippetTarget, type SnippetTarget } from '@/lib/snippetInsertion'
import { registerTerminalActions } from '@/lib/terminalActions'
import { recentSnippetIds, recordSnippetUse, resetSnippetQuickAccess } from '@/lib/snippetQuickAccess'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import { writeClipboardText } from '@/lib/clipboard'
import { useSessionStore } from '@/store/session'
import { resetWorkspaceView, useWorkspaceViewStore } from '@/store/workspaceView'
import { SnippetQuickPicker } from './SnippetQuickPicker'

vi.mock('@/api/snippet', () => ({ snippetApi: { list: vi.fn() } }))
vi.mock('@/lib/clipboard', () => ({ writeClipboardText: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const snippet = (id = 'a', name = 'Alpha', content = 'df -h'): Snippet => ({
  id, name, content, description: '检查磁盘', tags: ['Linux'], is_global: false, created_at: '', updated_at: '',
})
let host: HTMLDivElement, root: Root, terminal: HTMLTextAreaElement
let unregister: () => void
const insert = vi.fn(), focus = vi.fn(), close = vi.fn(), manage = vi.fn()
let safePaste = true

function Harness({ target }: { target: SnippetTarget | null }) {
  const [open, setOpen] = useState(true)
  return open ? <SnippetQuickPicker target={target} onClose={() => { close(); setOpen(false) }}
    onManage={() => { manage(); setOpen(false) }} /> : <button autoFocus>返回应用</button>
}
beforeEach(async () => {
  await resetWorkspaceView()
  vi.resetAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setWorkspaceGeneration(1)
  resetSnippetQuickAccess()
  safePaste = true
  useSessionStore.setState({ activeTabId: 't', tabs: [{ id: 't', profileId: 'p', profileName: '生产环境', sessionId: 's', status: 'connected' }] })
  terminal = document.createElement('textarea')
  terminal.setAttribute('aria-label', '终端输入')
  document.body.append(terminal)
  terminal.focus()
  focus.mockImplementation(() => terminal.focus())
  unregister = registerTerminalActions('t', { insert, focus, reconnect: vi.fn(), search: vi.fn(), safeMultiline: () => safePaste })
  vi.mocked(snippetApi.list).mockResolvedValue([snippet()])
  vi.mocked(writeClipboardText).mockResolvedValue(undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount(); await new Promise((resolve) => setTimeout(resolve, 0)) })
  unregister()
  window.dispatchEvent(new Event('blur'))
  host.remove(); terminal.remove()
  vi.restoreAllMocks()
})
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === label)!
const input = () => document.querySelector<HTMLInputElement>('[role="combobox"]')!
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
async function render(target = snippetTarget()) { await act(async () => root.render(<Harness target={target} />)) }
async function key(key: string, target: HTMLElement = input(), extra: KeyboardEventInit = {}) {
  await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })))
}
async function query(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function click(label: string) { await act(async () => button(label).click()) }

it('打开聚焦搜索，键盘选择只插入一次，按住回车不会泄漏给终端且关闭后恢复焦点', async () => {
  vi.mocked(snippetApi.list).mockResolvedValue([snippet('z', 'Zulu', 'ls'), snippet()])
  const leaked = vi.fn()
  document.addEventListener('keydown', leaked)
  try {
    await render()
    expect(document.activeElement).toBe(input())
    expect(document.body.textContent).toContain('目标：生产环境')
    expect(options()[0].textContent).toContain('Alpha')
    await key('ArrowDown')
    expect(options()[1].getAttribute('aria-selected')).toBe('true')
    await key('ArrowUp')
    const original = input()
    await act(async () => {
      original.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      original.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true }))
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(insert).toHaveBeenCalledExactlyOnceWith('df -h', false)
    expect(close).toHaveBeenCalledOnce()
    expect(recentSnippetIds()).toEqual(['a'])
    expect(document.activeElement).toBe(terminal)
    await key('Enter', terminal, { repeat: true })
    expect(leaked).not.toHaveBeenCalled()
    terminal.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await key('Enter', terminal)
    expect(leaked).toHaveBeenCalledOnce()
  } finally { document.removeEventListener('keydown', leaked) }
})

it('搜索字段忽略大小写，切换查询重置选择且滚动选中结果', async () => {
  const scroll = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scroll, configurable: true })
  vi.mocked(snippetApi.list).mockResolvedValue([snippet(), snippet('z', 'Zulu', 'docker ps')])
  await render()
  await key('ArrowDown')
  await query('LINUX')
  expect(options()[0].getAttribute('aria-selected')).toBe('true')
  await query('DOCKER')
  expect(options()).toHaveLength(1)
  expect(options()[0].textContent).toContain('Zulu')
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
  await query('不存在')
  expect(document.body.textContent).toContain('暂无匹配片段')
  expect(button('插入终端').disabled).toBe(true)
  await key('Enter')
  expect(insert).not.toHaveBeenCalled()
})

it('中文输入法确认不插入片段，组合输入结束后回车才选择', async () => {
  await render()
  await act(async () => input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  await key('Enter')
  await key('ArrowDown', input(), { isComposing: true })
  expect(insert).not.toHaveBeenCalled()
  await act(async () => input().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await key('Enter', input(), { isComposing: true })
  expect(insert).not.toHaveBeenCalled()
  await key('Enter')
  expect(insert).toHaveBeenCalledExactlyOnceWith('df -h', false)
})

it('静止鼠标不会改掉默认选中项，移动鼠标后才切换选择', async () => {
  vi.mocked(snippetApi.list).mockResolvedValue([snippet(), snippet('z', 'Zulu', 'ls')])
  await render()
  await act(async () => options()[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  expect(options()[0].getAttribute('aria-selected')).toBe('true')
  await act(async () => options()[1].dispatchEvent(new Event('pointermove', { bubbles: true })))
  expect(options()[1].getAttribute('aria-selected')).toBe('true')
  await key('Enter')
  expect(insert).toHaveBeenCalledExactlyOnceWith('ls', false)
})

it('多行先预览完整内容，Esc 返回列表和查询，确认只插入归一化内容', async () => {
  vi.mocked(snippetApi.list).mockResolvedValue([snippet('a', '多行检查', 'pwd\r\nls')])
  await render()
  await query('检查')
  expect(options()[0].textContent).toContain('多行')
  await key('Enter')
  expect(insert).not.toHaveBeenCalled()
  expect(document.querySelector('pre')?.textContent).toBe('pwd\r\nls')
  expect(button('明确执行这段命令')).toBeUndefined()
  await key('Escape', document.activeElement as HTMLElement)
  expect(input().value).toBe('检查')
  expect(document.activeElement).toBe(input())
  expect(close).not.toHaveBeenCalled()
  await key('Enter')
  await click('只插入')
  expect(insert).toHaveBeenCalledExactlyOnceWith('pwd\nls', false)
})

it('多行粘贴不安全时禁止插入，仍可复制且不记最近使用', async () => {
  safePaste = false
  vi.mocked(snippetApi.list).mockResolvedValue([snippet('a', '多行', 'pwd\nls')])
  await render()
  await key('Enter')
  expect(button('只插入').disabled).toBe(true)
  expect(document.body.textContent).toContain('安全的多行粘贴')
  await click('复制内容')
  expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith('pwd\nls')
  expect(insert).not.toHaveBeenCalled()
  expect(recentSnippetIds()).toEqual([])
})

it('复制失败可重试，复制不关闭或记录使用', async () => {
  vi.mocked(writeClipboardText).mockRejectedValueOnce(new Error('剪贴板不可用')).mockResolvedValue(undefined)
  await render()
  await click('复制当前片段')
  expect(toast.error).toHaveBeenCalledWith('剪贴板不可用')
  await click('复制当前片段')
  expect(writeClipboardText).toHaveBeenCalledTimes(2)
  expect(close).not.toHaveBeenCalled()
  expect(recentSnippetIds()).toEqual([])
})

it('插入失败保留选择，不关闭也不记录使用，可再次尝试', async () => {
  insert.mockImplementationOnce(() => { throw new Error('终端写入失败') })
  await render()
  await key('Enter')
  expect(toast.error).toHaveBeenCalledWith('终端写入失败')
  expect(close).not.toHaveBeenCalled()
  expect(recentSnippetIds()).toEqual([])
  await key('Enter')
  expect(insert).toHaveBeenCalledTimes(2)
  expect(close).toHaveBeenCalledOnce()
})

it('工具页面不捕获后台终端，允许搜索复制且插入禁用', async () => {
  useWorkspaceViewStore.getState().openVault()
  expect(snippetTarget()).toBeNull()
  await render(null)
  expect(document.body.textContent).toContain('请先选择已连接的终端')
  expect(button('插入终端').disabled).toBe(true)
  await click('复制当前片段')
  expect(writeClipboardText).toHaveBeenCalledWith('df -h')
  await key('Enter')
  expect(insert).not.toHaveBeenCalled()
})

it('打开后切换激活标签仍固定原目标', async () => {
  const otherInsert = vi.fn()
  const unregisterOther = registerTerminalActions('other', { insert: otherInsert, focus: vi.fn(), reconnect: vi.fn(), search: vi.fn(), safeMultiline: () => true })
  try {
    await render()
    await act(async () => useSessionStore.setState((state) => ({ activeTabId: 'other', tabs: [...state.tabs, { id: 'other', profileId: 'p2', profileName: '另一台服务器', sessionId: 's2', status: 'connected' }] })))
    await key('Enter')
    expect(insert).toHaveBeenCalledExactlyOnceWith('df -h', false)
    expect(otherInsert).not.toHaveBeenCalled()
    expect(useSessionStore.getState().activeTabId).toBe('t')
  } finally { unregisterOther() }
})

it('断开后即使同一 sessionId 恢复，也必须重新打开快选器', async () => {
  await render()
  await act(async () => {
    useSessionStore.getState().updateTabStatus('t', 'disconnected')
    useSessionStore.getState().updateTabStatus('t', 'connected', 's')
  })
  expect(button('插入终端').disabled).toBe(true)
  await key('Enter')
  expect(insert).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('目标终端已变化')
})

it.each(['关闭', '重连', '空间切换'])('%s 使原目标失效', async (change) => {
  await render()
  await act(async () => {
    if (change === '关闭') useSessionStore.setState({ tabs: [] })
    if (change === '重连') useSessionStore.getState().updateTabStatus('t', 'connected', '新会话')
    if (change === '空间切换') {
      setWorkspaceGeneration(2)
      useSessionStore.setState((state) => ({ tabs: [...state.tabs] }))
    }
  })
  await key('Enter')
  expect(insert).not.toHaveBeenCalled()
  expect(button('插入终端').disabled).toBe(true)
})

it('读取失败可重试，无片段状态与无匹配不同', async () => {
  vi.mocked(snippetApi.list).mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue([])
  await render()
  expect(document.body.textContent).toContain('片段读取失败')
  await click('重试')
  expect(document.body.textContent).toContain('暂无命令片段')
  expect(button('复制当前片段').disabled).toBe(true)
  expect(snippetApi.list).toHaveBeenCalledTimes(2)
})

it('忽略关闭后和旧工作空间的读取响应', async () => {
  let resolve!: (items: Snippet[]) => void
  vi.mocked(snippetApi.list).mockImplementation(() => new Promise((done) => { resolve = done }))
  await render()
  expect(document.body.textContent).toContain('正在读取片段')
  await act(async () => { setWorkspaceGeneration(2); resolve([snippet('old', '旧空间片段')]) })
  expect(document.body.textContent).not.toContain('旧空间片段')
  await act(async () => root.render(null))
  await render()
  await act(async () => root.render(null))
  await act(async () => resolve([snippet('closed', '关闭后的片段')]))
  expect(document.querySelector('[role="option"]')).toBeNull()
})

it('关闭后最近使用保留，每次重新打开重读列表', async () => {
  vi.mocked(snippetApi.list).mockResolvedValue([snippet(), snippet('z', 'Zulu', 'ls')])
  await render()
  await act(async () => options()[1].click())
  expect(recentSnippetIds()).toEqual(['z'])
  await act(async () => root.render(null))
  await render()
  expect(options()[0].textContent).toContain('Zulu')
  expect(snippetApi.list).toHaveBeenCalledTimes(2)
  await act(async () => root.render(null))
  vi.mocked(snippetApi.list).mockResolvedValue([snippet()])
  await render()
  expect(options()).toHaveLength(1)
  expect(options()[0].textContent).toContain('Alpha')
})

it('Esc 关闭不记录使用，管理片段交接焦点时不抢回终端', async () => {
  recordSnippetUse('不存在')
  await render()
  await key('Escape')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(close).toHaveBeenCalledOnce()
  expect(recentSnippetIds()).toEqual(['不存在'])
  await act(async () => root.render(null))
  focus.mockClear()
  await render()
  await click('管理片段')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(manage).toHaveBeenCalledOnce()
  expect(focus).not.toHaveBeenCalled()
  expect(document.activeElement?.textContent).toBe('返回应用')
})
