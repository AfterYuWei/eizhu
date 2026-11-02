// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import type { SessionTab } from '@/store/session'
import type { ServerMetricDetail, ServerMetricKind, ServerMetricsSummary } from '@/api/serverDetail'
import { ServerStatusBar } from './ServerStatusBar'

const { api } = vi.hoisted(() => ({
  api: { getSummary: vi.fn(), getMetricDetail: vi.fn(), getInfo: vi.fn() },
}))
vi.mock('@/api/serverDetail', () => ({ serverDetailApi: api }))
const tab: SessionTab = {
  id: 'one',
  profileId: 'p',
  profileName: '测试服务器',
  sessionId: 'ssh-one',
  status: 'connected',
  host: 'example.test',
  port: 2200,
  username: 'user',
}
const summary: ServerMetricsSummary = {
  cpu: 12.5,
  mem_percent: 82,
  disk_percent: 26,
  net_rx: 38400,
  net_tx: 30720,
}
const details = {
  cpu: { kind: 'cpu', cpu: 12.5, cpu_detail: [10, 15], cpu_mhz: 2400 },
  memory: {
    kind: 'memory',
    mem_used: 82,
    mem_total: 100,
    mem_percent: 82,
    mem_detail: [{ name: 'example-process', percent: 10, rss: 1024 }],
  },
  disk: {
    kind: 'disk',
    disk_used: 26,
    disk_total: 100,
    disk_percent: 26,
    volumes: [{ filesystem: '/dev/vda', path: '/', used: 26, total: 100, percent: 26 }],
  },
  network: {
    kind: 'network',
    net_rx: 38400,
    net_tx: 30720,
    net_detail: [{ name: 'eth0', rx: 38400, tx: 30720 }],
  },
} satisfies Record<ServerMetricKind, ServerMetricDetail>
let host: HTMLDivElement, root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  vi.resetAllMocks()
  setWorkspaceGeneration(1)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  api.getSummary.mockResolvedValue(summary)
  api.getMetricDetail.mockImplementation(async (_id: string, kind: ServerMetricKind) => details[kind])
  api.getInfo.mockResolvedValue({ hostname: 'test-host', os: 'Debian 12', kernel: '6.1', arch: 'x86_64' })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function render(current = tab) {
  await act(async () =>
    root.render(
      <ServerStatusBar key={`${current.id}:${current.sessionId}:${current.status}`} tab={current} />,
    ),
  )
}
function item(kind: string) {
  return host.querySelector<HTMLButtonElement>(`[data-metric="${kind}"]`)!
}
async function pointer(kind: string, type: 'pointerover' | 'pointerout') {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { pointerType: 'mouse', relatedTarget: document.body })
  await act(async () => item(kind).dispatchEvent(event))
}
async function hover(kind: string) {
  await pointer(kind, 'pointerover')
  await act(async () => vi.advanceTimersByTime(300))
}

it('静态底栏只取摘要，各项有图标；悬浮时只展开对应详情，无聚合页签', async () => {
  await render()
  expect(host.textContent).toContain('CPU13%内存82%硬盘26%网络↓ 37.5 KB/s ↑ 30 KB/s服务器信息')
  expect(host.querySelectorAll('[data-metric] svg')).toHaveLength(5)
  expect(api.getMetricDetail).not.toHaveBeenCalled()
  expect(api.getInfo).not.toHaveBeenCalled()
  await pointer('cpu', 'pointerover')
  expect(api.getMetricDetail).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTime(300))
  expect(api.getMetricDetail).toHaveBeenCalledWith('ssh-one', 'cpu')
  expect(document.querySelector('.server-status-hover')?.textContent).toContain('Core 0')
  expect(document.querySelector('.server-status-hover')?.textContent).not.toContain('进程')
  expect(document.querySelector('[role="tablist"]')).toBeNull()
  await pointer('cpu', 'pointerout')
  await hover('memory')
  expect(document.querySelectorAll('.server-status-hover')).toHaveLength(1)
  expect(document.querySelector('.server-status-hover')?.textContent).toContain('example-process')
  expect(document.querySelector('.server-status-hover')?.textContent).not.toContain('Core 0')
  expect(api.getMetricDetail).toHaveBeenLastCalledWith('ssh-one', 'memory')
})
it('服务器信息通过悬浮或键盘聚焦读取，Escape 关闭，离开后停止详情轮询', async () => {
  await render()
  await act(async () => item('info').focus())
  await act(async () => vi.advanceTimersByTime(300))
  expect(document.querySelector('.server-status-hover')?.getAttribute('aria-label')).toBe('服务器信息')
  expect(document.querySelector('.server-status-info')?.textContent).toContain('user@example.test:2200')
  expect(document.querySelector('.server-status-info')?.textContent).toContain('Debian 12')
  expect(api.getMetricDetail).not.toHaveBeenCalled()
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
  expect(item('info').getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(item('info'))
  await act(async () => vi.advanceTimersByTime(6000))
  expect(api.getInfo).toHaveBeenCalledTimes(1)
})
it('切换悬浮项目或终端不会被旧请求覆盖，断开时不发起查询', async () => {
  let resolve!: (value: typeof details.cpu) => void
  api.getMetricDetail.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await render()
  await hover('cpu')
  expect(document.querySelector('.server-status-hover')?.textContent).toContain('正在读取')
  await pointer('cpu', 'pointerout')
  await hover('disk')
  expect(document.querySelector('.server-status-hover')?.textContent).toContain('挂载点')
  await act(async () => resolve(details.cpu))
  expect(document.querySelector('.server-status-hover')?.textContent).toContain('挂载点')
  await render({ ...tab, id: 'second', sessionId: 'ssh-two', profileName: '同服务器的另一终端' })
  expect(document.querySelector('.server-status-hover')).toBeNull()
  expect(api.getSummary).toHaveBeenLastCalledWith('ssh-two')
  await render({ ...tab, status: 'disconnected' })
  const count = api.getSummary.mock.calls.length
  expect(item('cpu').textContent).toBe('CPU—')
  await hover('network')
  expect(document.querySelector('.server-status-hover')?.textContent).toContain('已断开')
  expect(api.getSummary).toHaveBeenCalledTimes(count)
})
it('首次采样显示占位；网络小于每秒一个字节和零流量也有正确单位', async () => {
  let resolve!: (value: ServerMetricsSummary) => void
  api.getSummary.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await render()
  expect(item('cpu').textContent).toBe('CPU—')
  await act(async () => resolve({ ...summary, net_rx: 0.5, net_tx: 0 }))
  expect(item('network').textContent).toContain('↓ 0.5 B/s ↑ 0 B/s')
})
