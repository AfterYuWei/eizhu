// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useServerDetailStore } from '@/store/serverDetail'
import { useSidebarDetailStore } from '@/store/sidebarDetail'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import { ServerDetail } from './index'

const { api } = vi.hoisted(() => ({ api: { createSession: vi.fn(), closeSession: vi.fn(), listFiles: vi.fn(), getInfo: vi.fn() } }))
vi.mock('@/api/serverDetail', () => ({ serverDetailApi: api }))
vi.mock('@/hooks/useServerMetrics', () => ({ useServerMetrics: () => {} }))
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
