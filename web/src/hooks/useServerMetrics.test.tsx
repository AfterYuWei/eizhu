// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const { api } = vi.hoisted(() => ({ api: { getMetrics: vi.fn(), createSession: vi.fn(), getInfo: vi.fn(), listFiles: vi.fn(), closeSession: vi.fn() } }))
vi.mock('@/api/serverDetail', () => ({ serverDetailApi: api }))
vi.mock('@/lib/editorWindow', () => ({ openEditorFile: vi.fn() }))
vi.mock('@/store/profile', () => ({ useProfileStore: { getState: () => ({ updateDetectedIcon: vi.fn() }) } }))
import { useServerMetrics } from './useServerMetrics'
import { useServerDetailStore as store } from '@/store/serverDetail'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
let root: Root
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetAllMocks(); setWorkspaceGeneration(1); store.setState(store.getInitialState(), true)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  api.createSession.mockResolvedValue({ session_id: 'one', home_dir: '/home' }); api.getInfo.mockResolvedValue({ icon: '' }); api.listFiles.mockResolvedValue({ entries: [] }); api.closeSession.mockResolvedValue(undefined)
  await store.getState().connect('p')
  root = createRoot(document.createElement('div'))
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.restoreAllMocks() })
function Test({ active }: { active: boolean }) { useServerMetrics('p', active); return null }
it('只有可见详情三秒采样，折叠及进入后台立即停止，返回后继续', async () => {
  api.getMetrics.mockImplementation(async () => ({ ...store.getState().details.p.metrics, timestamp: Date.now() }))
  await act(async () => root.render(<Test active={false} />)); expect(api.getMetrics).not.toHaveBeenCalled()
  await act(async () => root.render(<Test active />)); expect(api.getMetrics).toHaveBeenCalledTimes(1)
  await act(async () => { vi.advanceTimersByTime(3000) }); expect(api.getMetrics).toHaveBeenCalledTimes(2)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => { vi.advanceTimersByTime(9000) }); expect(api.getMetrics).toHaveBeenCalledTimes(2)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  await act(async () => document.dispatchEvent(new Event('visibilitychange'))); expect(api.getMetrics).toHaveBeenCalledTimes(3)
  await act(async () => root.render(<Test active={false} />)); await act(async () => { vi.advanceTimersByTime(6000) }); expect(api.getMetrics).toHaveBeenCalledTimes(3)
})
it('隐藏后重新显示不重叠采样，丢弃隐藏期及旧空间结果', async () => {
  let resolve!: (response: ReturnType<typeof store.getState>['details'][string]['metrics']) => void
  api.getMetrics.mockImplementation(() => new Promise((done) => { resolve = done }))
  const metrics = { ...store.getState().details.p.metrics, timestamp: 3000, cpu: 80 }
  await act(async () => root.render(<Test active />))
  await act(async () => root.render(<Test active={false} />)); await act(async () => root.render(<Test active />))
  expect(api.getMetrics).toHaveBeenCalledTimes(1)
  await act(async () => resolve(metrics)); expect(store.getState().details.p.samples).toEqual([])
  await act(async () => { vi.advanceTimersByTime(3000) }); expect(api.getMetrics).toHaveBeenCalledTimes(2)
  await act(async () => { setWorkspaceGeneration(2); store.setState(store.getInitialState(), true) })
  await act(async () => resolve(metrics)); expect(store.getState().details).toEqual({})
})
