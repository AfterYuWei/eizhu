// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useServerDetailStore } from '@/store/serverDetail'
import { useSidebarDetailStore } from '@/store/sidebarDetail'
import { useSessionStore } from '@/store/session'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import { ServerDetail } from './index'

const { api } = vi.hoisted(() => ({ api: { createSession: vi.fn(), closeSession: vi.fn(), listFiles: vi.fn(), getInfo: vi.fn() } }))
vi.mock('@/api/serverDetail', () => ({ serverDetailApi: api }))
vi.mock('@/components/Editor/EditorDialog', () => ({ EditorDialog: () => null }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

let host: HTMLDivElement, root: Root
beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.resetAllMocks()
  setWorkspaceGeneration(1)
  useServerDetailStore.setState({ details: {} })
  useSidebarDetailStore.setState({ detailCache: {} })
  useSessionStore.setState({ tabs: [] })
  api.closeSession.mockResolvedValue(undefined)
  api.getInfo.mockResolvedValue({})
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<ServerDetail tabId="tab" profileId="server" profileName="测试服务器" host="example.test" port={22} username="user" active />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useServerDetailStore.setState({ details: {} })
  useSidebarDetailStore.setState({ detailCache: {} })
  useSessionStore.setState({ tabs: [] })
  vi.useRealTimers()
})

it('右侧文件连接失效后自动重连，失败后延迟重试并恢复原目录', async () => {
  vi.useFakeTimers()
  api.createSession.mockResolvedValue({ session_id: 'detail', home_dir: '/home' })
  api.listFiles.mockImplementation(async (_id: string, path: string) => ({ path, entries: [] }))
  await act(async () => {
    useSessionStore.setState({ tabs: [{ id: 'tab', profileId: 'server', profileName: '服务器', sessionId: 'ssh', status: 'connected', detailAttached: true }] })
    await useServerDetailStore.getState().connect('server')
    await useServerDetailStore.getState().listFiles('server', '/work')
  })
  api.createSession.mockRejectedValueOnce(new Error('暂时无法连接'))
  await act(async () => useServerDetailStore.getState().markDisconnected('server'))
  await act(async () => vi.advanceTimersByTime(1000))
  expect(api.createSession).toHaveBeenCalledTimes(2)
  await act(async () => vi.advanceTimersByTime(1000))
  expect(api.createSession).toHaveBeenCalledTimes(2)
  api.createSession.mockResolvedValueOnce({ session_id: 'new-detail', home_dir: '/home' })
  await act(async () => vi.advanceTimersByTime(1000))
  expect(api.createSession).toHaveBeenCalledTimes(3)
  expect(api.listFiles).toHaveBeenLastCalledWith('new-detail', '/work', false)
  expect(useServerDetailStore.getState().getStatus('server')).toMatchObject({ status: 'connected', refCount: 1 })
})

it('SSH 同 ID 重连的状态被批量渲染时仍自动恢复侧栏文件服务', async () => {
  vi.useFakeTimers()
  api.createSession.mockResolvedValue({ session_id: 'detail', home_dir: '/home' })
  api.listFiles.mockImplementation(async (_id: string, path: string) => ({ path, entries: [] }))
  await act(async () => {
    useSessionStore.setState({ tabs: [{ id: 'tab', profileId: 'server', profileName: '服务器', sessionId: 'ssh', status: 'connected', detailAttached: true }] })
    await useServerDetailStore.getState().connect('server')
  })
  await act(async () => {
    useSessionStore.getState().updateTabStatus('tab', 'reconnecting')
    useSessionStore.getState().updateTabStatus('tab', 'connected')
  })
  await act(async () => vi.advanceTimersByTime(1000))
  expect(api.createSession).toHaveBeenCalledTimes(2)
})

it('SSH 尚未恢复或侧栏已隐藏时不重连，最后一个所有者关闭后取消重试', async () => {
  vi.useFakeTimers()
  api.createSession.mockResolvedValue({ session_id: 'detail', home_dir: '/home' })
  api.listFiles.mockImplementation(async (_id: string, path: string) => ({ path, entries: [] }))
  await act(async () => {
    useSessionStore.setState({ tabs: [{ id: 'tab', profileId: 'server', profileName: '服务器', sessionId: 'ssh', status: 'connected', detailAttached: true }] })
    await useServerDetailStore.getState().connect('server')
  })
  await act(async () => useSessionStore.getState().updateTabStatus('tab', 'reconnecting'))
  await act(async () => vi.advanceTimersByTime(60000))
  expect(api.createSession).toHaveBeenCalledTimes(1)
  await act(async () => {
    useSessionStore.getState().updateTabStatus('tab', 'connected')
    root.render(<ServerDetail tabId="tab" profileId="server" profileName="测试服务器" host="example.test" port={22} username="user" active={false} />)
  })
  await act(async () => vi.advanceTimersByTime(60000))
  expect(api.createSession).toHaveBeenCalledTimes(1)
  await act(async () => {
    root.render(<ServerDetail tabId="tab" profileId="server" profileName="测试服务器" host="example.test" port={22} username="user" active />)
  })
  await act(async () => useServerDetailStore.getState().disconnect('server'))
  await act(async () => vi.advanceTimersByTime(60000))
  expect(api.createSession).toHaveBeenCalledTimes(1)
})

it('终端先上报目录时，等待文件服务就绪后自动定位，并在重连后重新定位', async () => {
  api.createSession.mockResolvedValue({ session_id: 'detail', status: 'connected', home_dir: '/' })
  api.listFiles.mockImplementation((_id: string, path: string) => Promise.resolve({ path, entries: [] }))
  await act(async () => {
    useSessionStore.setState({ tabs: [{ id: 'tab', profileId: 'server', profileName: '服务器', sessionId: 'ssh', status: 'connected', cwd: '/root' }] })
    await useServerDetailStore.getState().connect('server')
  })
  expect(useServerDetailStore.getState().getStatus('server').currentPath).toBe('/root')
  expect(host.querySelector('button[title="自动跟随已开启：点击关闭"]')).not.toBeNull()
  await act(async () => useSessionStore.getState().updateTabCwd('tab', '/srv/项目 files'))
  expect(useServerDetailStore.getState().getStatus('server').currentPath).toBe('/srv/项目 files')

  await act(async () => useServerDetailStore.getState().markDisconnected('server'))
  await act(async () => useSessionStore.getState().updateTabCwd('tab', '/root'))
  await act(async () => useServerDetailStore.getState().ensureConnected('server'))
  expect(useServerDetailStore.getState().getStatus('server').currentPath).toBe('/root')
})

it('同一服务器只跟随可见终端，切换回侧栏会定位，手动浏览和关闭跟随后保留目录', async () => {
  api.createSession.mockResolvedValue({ session_id: 'detail', status: 'connected', home_dir: '/' })
  api.listFiles.mockImplementation((_id: string, path: string) => Promise.resolve({ path, entries: [] }))
  const renderTabs = (firstActive: boolean) => root.render(<><ServerDetail tabId="tab" profileId="server" profileName="测试服务器" host="example.test" port={22} username="user" active={firstActive} /><ServerDetail tabId="other" profileId="server" profileName="测试服务器" host="example.test" port={22} username="user" active={!firstActive} /></>)
  await act(async () => {
    useSessionStore.setState({ tabs: [
      { id: 'tab', profileId: 'server', profileName: '服务器', sessionId: 'ssh', status: 'connected', cwd: '/root' },
      { id: 'other', profileId: 'server', profileName: '服务器', sessionId: 'other-ssh', status: 'connected', cwd: '/srv' },
    ] })
    await useServerDetailStore.getState().connect('server')
    renderTabs(true)
  })
  expect(useServerDetailStore.getState().getStatus('server').currentPath).toBe('/root')
  await act(async () => useSessionStore.getState().updateTabCwd('other', '/tmp'))
  expect(useServerDetailStore.getState().getStatus('server').currentPath).toBe('/root')
  await act(async () => renderTabs(false))
  expect(useServerDetailStore.getState().getStatus('server').currentPath).toBe('/tmp')

  const visible = host.querySelector<HTMLElement>('[aria-hidden="false"]')!
  await act(async () => visible.querySelector<HTMLButtonElement>('button[title="自动跟随已开启：点击关闭"]')!.click())
  await act(async () => useSessionStore.getState().updateTabCwd('other', '/var'))
  expect(useServerDetailStore.getState().getStatus('server').currentPath).toBe('/tmp')
  await act(async () => visible.querySelector<HTMLButtonElement>('button[title="自动跟随已关闭：点击开启"]')!.click())
  expect(useServerDetailStore.getState().getStatus('server').currentPath).toBe('/var')

  await act(async () => visible.querySelector<HTMLElement>('.sdetail-file-row')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(useSidebarDetailStore.getState().getDetail('other').followShellCwd).toBe(false)
  await act(async () => useSessionStore.getState().updateTabCwd('other', '/etc'))
  expect(useServerDetailStore.getState().getStatus('server').currentPath).toBe('/')
})

it('服务器侧栏在连接、读取和刷新目录期间显示进度，结束后恢复空目录或错误', async () => {
  const connection = deferred<Awaited<ReturnType<typeof import('@/api/serverDetail').serverDetailApi.createSession>>>()
  const listing = deferred<Awaited<ReturnType<typeof import('@/api/serverDetail').serverDetailApi.listFiles>>>()
  api.createSession.mockReturnValue(connection.promise)
  api.listFiles.mockReturnValue(listing.promise)
  let pending!: Promise<void>
  await act(async () => { pending = useServerDetailStore.getState().connect('server') })
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('正在连接服务器文件服务')
  await act(async () => {
    connection.resolve({ session_id: 'detail', status: 'connected', home_dir: '/' })
    await pending
  })
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('正在读取服务器文件列表')
  expect(host.textContent).not.toContain('空文件夹')
  await act(async () => listing.resolve({ path: '/', entries: [] }))
  expect(host.querySelector('[role="progressbar"]')).toBeNull()
  expect(host.textContent).toContain('空文件夹')
  const refresh = deferred<Awaited<ReturnType<typeof import('@/api/serverDetail').serverDetailApi.listFiles>>>()
  api.listFiles.mockReturnValue(refresh.promise)
  await act(async () => { pending = useServerDetailStore.getState().refresh('server') })
  expect(host.querySelector('[role="progressbar"]')).not.toBeNull()
  await act(async () => { refresh.reject(new Error('读取目录失败')); await pending })
  expect(host.querySelector('[role="progressbar"]')).toBeNull()
  expect(host.textContent).toContain('读取目录失败')
  expect(host.textContent).not.toContain('空文件夹')
})
