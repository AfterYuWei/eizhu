// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSftpStore, type SftpStoreApi } from '@/store/sftp'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import { SftpStoreContext } from './storeContext'
import { FilePane } from './FilePane'

const { api } = vi.hoisted(() => ({ api: { createSession: vi.fn(), list: vi.fn(), closeSession: vi.fn(), getSession: vi.fn(), tree: vi.fn() } }))
vi.mock('@/api/sftp', () => ({ sftpApi: api }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

let host: HTMLDivElement, root: Root, store: SftpStoreApi
beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.resetAllMocks()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  setWorkspaceGeneration(1)
  api.closeSession.mockResolvedValue(undefined)
  store = createSftpStore()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<SftpStoreContext.Provider value={store}><FilePane pane="left" onPickServer={() => {}} /></SftpStoreContext.Provider>))
})
afterEach(async () => {
  await act(async () => root.unmount())
  await store.getState().dispose()
  host.remove()
  vi.unstubAllGlobals()
})

it('连接、首次读取目录和完成状态依次更新，不把等待过程显示为空目录', async () => {
  const connection = deferred<Awaited<ReturnType<typeof import('@/api/sftp').sftpApi.createSession>>>()
  const listing = deferred<Awaited<ReturnType<typeof import('@/api/sftp').sftpApi.list>>>()
  api.createSession.mockReturnValue(connection.promise)
  api.list.mockReturnValue(listing.promise)
  let pending!: Promise<void>
  await act(async () => { pending = store.getState().connectServer('left', store.getState().leftTabs[0].server) })
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toContain('正在连接')
  expect(host.textContent).not.toContain('空文件夹')
  await act(async () => connection.resolve({ session_id: 'session', status: 'connected', home_dir: '/home' }))
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('正在读取文件列表')
  expect(host.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false)
  expect(host.textContent).not.toContain('空文件夹')
  await act(async () => {
    listing.resolve({ path: '/home', entries: [{ name: 'test.txt', path: '/home/test.txt', is_dir: false, size: 1, mod_time: '' }] })
    await pending
  })
  expect(host.querySelector('[role="progressbar"]')).toBeNull()
  expect(host.textContent).toContain('test.txt')
})

it('已分配会话但等待主机确认时仍显示连接进度；失败后结束进度并可重试', async () => {
  const tab = store.getState().leftTabs[0]
  await act(async () => store.setState({ leftTabs: [{ ...tab, sessionId: 'pending', connecting: true, loading: true }], pendingHostKey: { sessionId: 'request', pane: 'left', tabId: tab.id, serverName: '服务器', fingerprint: 'SHA256:test' } }))
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toContain('等待确认主机指纹')
  await act(async () => store.setState({ leftTabs: [{ ...tab, error: '连接超时' }], pendingHostKey: null }))
  expect(host.querySelector('[role="progressbar"]')).toBeNull()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('连接超时')
  expect(host.textContent).not.toContain('空文件夹')
  api.createSession.mockRejectedValue(new Error('认证失败'))
  await act(async () => host.querySelector<HTMLButtonElement>('.sftp-pane-error button')!.click())
  expect(api.createSession).toHaveBeenCalled()
  expect(store.getState().leftTabs[0]).toMatchObject({ connecting: false, loading: false, error: '认证失败' })
})

it('刷新及树视图读取都有进度，切换到其他标签不会沿用旧标签的加载状态', async () => {
  const tab = store.getState().leftTabs[0]
  await act(async () => store.setState({ leftTabs: [{ ...tab, sessionId: 'session', view: 'tree' }] }))
  const tree = deferred<Awaited<ReturnType<typeof import('@/api/sftp').sftpApi.tree>>>()
  api.tree.mockReturnValue(tree.promise)
  let pending!: Promise<void>
  await act(async () => {
    store.setState({ leftTabs: [{ ...tab, sessionId: 'session' }] })
    pending = store.getState().toggleView('left')
  })
  expect(host.querySelector('[role="progressbar"]')).not.toBeNull()
  expect(host.querySelector('.sftp-list-empty')).toBeNull()
  await act(async () => store.setState({ leftTabs: [...store.getState().leftTabs, { ...tab, id: 'other' }], activeLeftTabId: 'other' }))
  expect(host.querySelector('[role="progressbar"]')).toBeNull()
  await act(async () => { tree.resolve({ path: '/', entries: [] }); await pending })
  expect(store.getState().leftTabs[0].loading).toBe(false)
})
