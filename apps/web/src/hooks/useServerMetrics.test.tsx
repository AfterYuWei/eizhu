// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useServerMetrics } from './useServerMetrics'
import type { ServerInspectionTarget } from './useServerMetrics'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import type { ServerMetricsSummary } from '@/api/serverDetail'

const { api } = vi.hoisted(() => ({
  api: { getSummary: vi.fn(), getMetricDetail: vi.fn(), getInfo: vi.fn() },
}))
vi.mock('@/api/serverDetail', () => ({ serverDetailApi: api }))
const summary: ServerMetricsSummary = { cpu: 25, mem_percent: 40, disk_percent: 50, net_rx: 100, net_tx: 200 }
let root: Root
let result: ReturnType<typeof useServerMetrics>
beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  setWorkspaceGeneration(1)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  api.getSummary.mockResolvedValue(summary)
  api.getInfo.mockResolvedValue({ hostname: 'host' })
  api.getMetricDetail.mockResolvedValue({
    kind: 'memory',
    mem_used: 40,
    mem_total: 100,
    mem_percent: 40,
    mem_detail: [],
  })
  root = createRoot(document.createElement('div'))
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function Test({
  id = 'one',
  active = true,
  target = null,
}: {
  id?: string
  active?: boolean
  target?: ServerInspectionTarget | null
}) {
  const value = useServerMetrics(id, active, target)
  useEffect(() => {
    result = value
  }, [value])
  return null
}
async function render(props: Parameters<typeof Test>[0] = {}) {
  await act(async () => root.render(<Test {...props} />))
}

it('后台只采集摘要，可见时三秒刷新，隐藏和断开后停止', async () => {
  await render({ active: false })
  expect(api.getSummary).not.toHaveBeenCalled()
  await render()
  expect(api.getSummary).toHaveBeenCalledWith('one')
  expect(api.getMetricDetail).not.toHaveBeenCalled()
  expect(api.getInfo).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTime(3000))
  expect(api.getSummary).toHaveBeenCalledTimes(2)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => vi.advanceTimersByTime(9000))
  expect(api.getSummary).toHaveBeenCalledTimes(2)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(api.getSummary).toHaveBeenCalledTimes(3)
  await render({ active: false })
  await act(async () => vi.advanceTimersByTime(6000))
  expect(api.getSummary).toHaveBeenCalledTimes(3)
  expect(result.summary).toBeNull()
})
it('详情只读取当前悬浮项目，切换项目丢弃迟到结果，离开后停止详情刷新', async () => {
  let resolve!: (value: { kind: 'cpu'; cpu: number; cpu_detail: number[]; cpu_mhz: number }) => void
  api.getMetricDetail.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await render({ target: 'cpu' })
  expect(api.getMetricDetail).toHaveBeenCalledWith('one', 'cpu')
  await render({ target: 'memory' })
  expect(api.getMetricDetail).toHaveBeenLastCalledWith('one', 'memory')
  expect(result.inspection?.kind).toBe('memory')
  await act(async () => resolve({ kind: 'cpu', cpu: 99, cpu_detail: [99], cpu_mhz: 2400 }))
  expect(result.inspection?.kind).toBe('memory')
  await render()
  const count = api.getMetricDetail.mock.calls.length
  await act(async () => vi.advanceTimersByTime(9000))
  expect(api.getMetricDetail).toHaveBeenCalledTimes(count)
  expect(result.inspection).toBeNull()
  await render({ target: 'info' })
  expect(api.getInfo).toHaveBeenCalledWith('one')
  expect(result.inspection?.kind).toBe('info')
  await render({ active: false, target: 'info' })
  await act(async () => vi.advanceTimersByTime(6000))
  expect(api.getInfo).toHaveBeenCalledTimes(1)
})
it('同一服务器的不同 SSH 会话与旧空间结果互不覆盖', async () => {
  let resolve!: (value: ServerMetricsSummary) => void
  api.getSummary.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await render({ id: 'first-terminal' })
  await render({ id: 'second-terminal' })
  expect(result.summary).toEqual(summary)
  await act(async () => resolve({ ...summary, cpu: 99 }))
  expect(result.summary?.cpu).toBe(25)
  api.getSummary.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await render({ id: 'old-workspace' })
  await act(async () => {
    setWorkspaceGeneration(2)
    resolve({ ...summary, cpu: 88 })
  })
  await render({ id: 'new-workspace', active: false })
  expect(result.summary).toBeNull()
})
it('摘要和详情失败分别反馈，失败重试有三秒间隔', async () => {
  api.getSummary.mockImplementation(() => {
    throw new Error('摘要采样失败')
  })
  await render({ target: 'memory' })
  expect(result.summaryError).toBe('摘要采样失败')
  expect(result.inspection?.kind).toBe('memory')
  await act(async () => vi.advanceTimersByTime(2999))
  expect(api.getSummary).toHaveBeenCalledTimes(1)
  api.getSummary.mockResolvedValue(summary)
  api.getMetricDetail.mockRejectedValue(new Error('进程不可读'))
  await act(async () => vi.advanceTimersByTime(1))
  expect(result.summary).toEqual(summary)
  expect(result.summaryError).toBeNull()
  expect(result.inspectionError).toBe('进程不可读')
})
it('同一会话隐藏后返回会复用在途只读采样，保持三秒采样且不会并发重复请求', async () => {
  let resolve!: (value: ServerMetricsSummary) => void
  api.getSummary.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await render()
  await render({ active: false })
  await render()
  expect(api.getSummary).toHaveBeenCalledTimes(1)
  await act(async () => resolve(summary))
  expect(result.summary).toEqual(summary)
  await act(async () => vi.advanceTimersByTime(3000))
  expect(api.getSummary).toHaveBeenCalledTimes(2)
  await act(async () => resolve(summary))
  expect(result.summary).toEqual(summary)
})

it('快速移开再移回同一项目复用在途详情，不等待下一轮采样', async () => {
  let resolve!: (value: { kind: 'cpu'; cpu: number; cpu_detail: number[]; cpu_mhz: number }) => void
  api.getMetricDetail.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await render({ target: 'cpu' })
  await render()
  await render({ target: 'cpu' })
  expect(api.getMetricDetail).toHaveBeenCalledTimes(1)
  await act(async () => resolve({ kind: 'cpu', cpu: 40, cpu_detail: [40], cpu_mhz: 2400 }))
  expect(result.inspection?.kind).toBe('cpu')
})
