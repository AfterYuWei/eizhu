// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/Sidebar'
import { WorkspaceTabs } from './WorkspaceTabs'
import { ServerInspector } from './ServerInspector'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useProfileStore } from '@/store/profile'
import { resetWorkspaceView, useWorkspaceViewStore } from '@/store/workspaceView'
import { useSessionStore } from '@/store/session'
import { useDesktopShellStore } from '@/store/desktopShell'
import type { Profile } from '@/types/profile'

vi.mock('@/components/ProfileForm', () => ({ ProfileForm: () => null }))
vi.mock('@/components/Sidebar/GroupForm', () => ({ GroupForm: () => null }))
vi.mock('@/components/ServerDetail', () => ({ ServerDetail: ({ tabId, active }: { tabId: string; active: boolean }) => <input data-detail-tab={tabId} data-active={String(active)} defaultValue="" /> }))
const profile: Profile = { id: 'p', name: '生产环境', host: 'example.test', port: 2200, username: 'root', auth_type: 'agent', proxy: { type: 'direct' }, group_id: 'child', tags: [], options: '{}', note: '', sort_order: 0, created_at: '', updated_at: '' }
let host: HTMLDivElement
let root: Root
beforeEach(async () => {
  await resetWorkspaceView()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useProfileStore.setState({ profiles: [profile], groups: [{ id: 'parent', name: '父分组', icon: '', sort_order: 0, created_at: '' }, { id: 'child', name: '子分组', parent_id: 'parent', icon: '', sort_order: 1, created_at: '' }] })
  useDesktopShellStore.setState({ collapsedGroups: {} })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('分组可折叠，服务器单击不连接，双击复用当前连接草稿', async () => {
  const open = vi.fn()
  useSessionStore.setState({ tabs: [{ id: 'draft', profileId: '', profileName: '新连接', status: 'disconnected', sessionId: null }], activeTabId: 'draft', openTab: open })
  await act(async () => root.render(<TooltipProvider><Sidebar /></TooltipProvider>))
  expect(host.querySelector('.shell-child-groups .srv')).not.toBeNull()
  const row = host.querySelector<HTMLElement>('.srv')!
  expect(row.title).toContain('root@example.test:2200')
  await act(async () => row.click())
  expect(open).not.toHaveBeenCalled()
  await act(async () => row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(open).toHaveBeenCalledWith('p', profile.name, profile.host, 2200, 'root', 'draft')
  await act(async () => host.querySelector<HTMLElement>('.grp-label')!.click())
  expect(host.querySelector('.srv')).toBeNull()
  expect(host.querySelector('.grp-label')!.getAttribute('aria-expanded')).toBe('false')
})

it('终端标签区分同名会话，工具页面不进入标签列表', async () => {
  useSessionStore.setState({ tabs: [
    { id: 'a', profileId: 'p', profileName: '生产环境', status: 'disconnected', sessionId: null },
    { id: 'b', profileId: 'p', profileName: '生产环境', status: 'disconnected', sessionId: null },
  ], activeTabId: 'a' })
  await act(async () => root.render(<TooltipProvider><WorkspaceTabs /></TooltipProvider>))
  expect(host.textContent).toContain('生产环境 (1)')
  expect(host.textContent).toContain('生产环境 (2)')
  await act(async () => useWorkspaceViewStore.getState().openVault())
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
  expect(host.querySelector('[aria-selected="true"]')).toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('[role="tab"]')!.click())
  expect(useWorkspaceViewStore.getState().activePage).toBe('terminal')
  expect(useSessionStore.getState().activeTabId).toBe('a')
})

it('详情仅按需挂载，切换后保留 DOM 状态，隐藏时停止激活', async () => {
  useSessionStore.setState({ tabs: [{ id: 'a', profileId: 'p', profileName: '生产环境', status: 'disconnected', sessionId: null }], activeTabId: 'a' })
  const render = async (open: boolean) => act(async () => root.render(<TooltipProvider><ServerInspector open={open} overlay={false} onClose={() => {}} /></TooltipProvider>))
  await render(false)
  expect(host.querySelector('[data-detail-tab]')).toBeNull()
  await render(true)
  const input = host.querySelector<HTMLInputElement>('[data-detail-tab="a"]')!
  expect(input.dataset.active).toBe('true')
  input.value = '保留状态'
  await render(false)
  expect(input.dataset.active).toBe('false')
  await render(true)
  expect(host.querySelector<HTMLInputElement>('[data-detail-tab="a"]')).toBe(input)
  expect(input.value).toBe('保留状态')
})
