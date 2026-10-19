// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SidebarResizeHandle } from './SidebarResizeHandle'
import { SIDEBAR_COLLAPSE_DELAY_MS } from '@/lib/desktopSidebar'

let host: HTMLDivElement
let root: Root
let handle: HTMLDivElement

function Harness() {
  const [width, setWidth] = useState(300)
  const [collapsed, setCollapsed] = useState(false)
  return <SidebarResizeHandle width={width} collapsed={collapsed} onResize={setWidth}
    onCollapse={() => setCollapsed(true)} onExpand={() => { setWidth(300); setCollapsed(false) }} />
}

async function pointer(type: string, x = 254, pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { button: 0, pointerId, clientX: x })
  await act(async () => handle.dispatchEvent(event))
}
async function wait(ms = SIDEBAR_COLLAPSE_DELAY_MS) { await act(async () => vi.advanceTimersByTime(ms)) }
const collapsed = () => handle.getAttribute('aria-hidden') === 'true'

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<Harness />))
  handle = host.querySelector('div')!
  handle.setPointerCapture = vi.fn()
  handle.hasPointerCapture = vi.fn(() => true)
  handle.releasePointerCapture = vi.fn()
  await pointer('pointerdown', 304)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
})

it('停顿期间重新拉宽会取消收起，再次到达边界才重新计时', async () => {
  await pointer('pointermove')
  await wait(180)
  await pointer('pointermove', 274)
  await wait()
  expect(collapsed()).toBe(false)
  expect(handle.getAttribute('aria-valuenow')).toBe('270')
  await pointer('pointermove')
  await wait(SIDEBAR_COLLAPSE_DELAY_MS - 1)
  expect(collapsed()).toBe(false)
  await wait(1)
  expect(collapsed()).toBe(true)
})

it('连续向左移动不会重置停顿计时，收起后向右移动可拉回，微小抖动不展开', async () => {
  await pointer('pointermove')
  await wait(120)
  await pointer('pointermove', 200)
  await wait(120)
  expect(collapsed()).toBe(true)
  await pointer('pointermove', 170)
  await pointer('pointermove', 174)
  expect(collapsed()).toBe(true)
  await pointer('pointermove', 178)
  expect(collapsed()).toBe(false)
  expect(handle.getAttribute('aria-valuenow')).toBe('300')
  await pointer('pointermove', 198)
  expect(handle.getAttribute('aria-valuenow')).toBe('300')
  await pointer('pointermove', 303)
  expect(handle.getAttribute('aria-valuenow')).toBe('300')
  await pointer('pointermove', 304)
  expect(handle.getAttribute('aria-valuenow')).toBe('300')
  await pointer('pointermove', 324)
  expect(handle.getAttribute('aria-valuenow')).toBe('320')
})

it('从较宽侧栏收起后等待鼠标追上默认边缘，保留原来的抓取偏移', async () => {
  await pointer('pointermove', 424)
  await pointer('pointerup', 424)
  await pointer('pointerdown', 427)
  await pointer('pointermove', 257)
  await wait()
  await pointer('pointermove', 265)
  expect(collapsed()).toBe(false)
  await pointer('pointermove', 306)
  expect(handle.getAttribute('aria-valuenow')).toBe('300')
  await pointer('pointermove', 307)
  expect(handle.getAttribute('aria-valuenow')).toBe('300')
  await pointer('pointermove', 317)
  expect(handle.getAttribute('aria-valuenow')).toBe('310')
  await pointer('pointermove', 297)
  expect(handle.getAttribute('aria-valuenow')).toBe('290')
})

it('快速向右越过默认边缘时立即跟上鼠标，重复收起展开不会累积偏移', async () => {
  await pointer('pointermove', 200)
  await wait()
  await pointer('pointermove', 354)
  expect(collapsed()).toBe(false)
  expect(handle.getAttribute('aria-valuenow')).toBe('350')
  await pointer('pointermove', 254)
  await wait()
  expect(collapsed()).toBe(true)
  await pointer('pointermove', 262)
  expect(handle.getAttribute('aria-valuenow')).toBe('300')
  await pointer('pointermove', 304)
  expect(handle.getAttribute('aria-valuenow')).toBe('300')
  await pointer('pointermove', 314)
  expect(handle.getAttribute('aria-valuenow')).toBe('310')
})

it('停顿期间松开仍会完成收起，但松开后向右移动不会展开', async () => {
  await pointer('pointermove')
  await pointer('pointerup')
  await pointer('lostpointercapture')
  await wait()
  expect(collapsed()).toBe(true)
  await pointer('pointermove', 340)
  expect(collapsed()).toBe(true)
  expect(handle.classList.contains('is-dragging')).toBe(false)
})

it.each(['pointercancel', 'lostpointercapture'])('%s 取消待收起计时并结束拖拽', async (event) => {
  await pointer('pointermove')
  await pointer(event)
  await wait()
  expect(collapsed()).toBe(false)
  expect(handle.classList.contains('is-dragging')).toBe(false)
  await pointer('pointermove', 190)
  expect(collapsed()).toBe(false)
})

it('收起后松开鼠标会释放捕获，后续移动不会重新拉回', async () => {
  await pointer('pointermove')
  await wait()
  await pointer('pointerup')
  await pointer('pointermove', 340)
  expect(collapsed()).toBe(true)
  expect(handle.releasePointerCapture).toHaveBeenCalledWith(1)
})

it('其他指针不能控制当前拖拽，窗口失焦取消等待', async () => {
  await pointer('pointermove', 240, 2)
  await wait()
  expect(handle.getAttribute('aria-valuenow')).toBe('300')
  await pointer('pointermove')
  await act(async () => window.dispatchEvent(new Event('blur')))
  await wait()
  expect(collapsed()).toBe(false)
  expect(handle.classList.contains('is-dragging')).toBe(false)
})

it('卸载时清理计时与捕获，避免稍后触发收起', async () => {
  await pointer('pointermove')
  await act(async () => root.render(null))
  expect(vi.getTimerCount()).toBe(0)
  expect(handle.releasePointerCapture).toHaveBeenCalledWith(1)
})
