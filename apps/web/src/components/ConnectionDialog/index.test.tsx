// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConnectionDialog } from './index'
import { writeClipboardText } from '@/lib/clipboard'
vi.mock('@/lib/clipboard', () => ({ writeClipboardText: vi.fn() }))
let host: HTMLDivElement, root: Root
const base: ComponentProps<typeof ConnectionDialog> = {
  open: true,
  onOpenChange: vi.fn(),
  profileName: '测试服务器',
  host: 'example.test',
  port: 22,
  username: 'user',
  status: 'connecting',
}
const render = async (props: Partial<ComponentProps<typeof ConnectionDialog>> = {}) =>
  act(async () => root.render(<ConnectionDialog {...base} {...props} />))
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((element) => element.textContent === text)!
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  vi.mocked(writeClipboardText).mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
})

it('uses backend operations rather than a fixed sequence and keeps elapsed time across stages', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(10000)
  await render({
    currentStage: 'proxy',
    logs: [{ at: 10000, level: 'info', stage: 'proxy', message: '正在连接 HTTP 代理' }],
  })
  expect(document.querySelector('.connection-status h2')?.textContent).toBe('连接代理或跳板')
  await act(async () => vi.advanceTimersByTime(4000))
  await render({
    currentStage: 'ssh_auth',
    logs: [
      { at: 10000, level: 'info', stage: 'proxy', message: '正在连接 HTTP 代理' },
      { at: 14000, level: 'info', stage: 'ssh_auth', message: '主机身份已确认' },
    ],
  })
  expect(document.querySelector('.connection-status h2')?.textContent).toBe('验证登录凭据')
  expect(document.querySelector('.connection-duration')?.textContent).toContain('4 秒')
  expect(document.querySelector('.connection-steps')).toBeNull()
})

it('advances smoothly within an attempt, pauses for confirmation and failure, and completes only on success', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(10000)
  const logs = [{ at: 10000, stage: 'preparing', level: 'info', message: '读取配置' }]
  const value = () =>
    Number(
      document
        .querySelector<HTMLElement>('.connection-progress-fill')!
        .style.transform.match(/scaleX\((.*)\)/)![1],
    )
  await render({ currentStage: 'preparing', logs })
  const initial = value()
  await act(async () => vi.advanceTimersByTime(4000))
  expect(value()).toBeGreaterThan(initial)
  expect(value()).toBeLessThan(1)
  expect(document.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false)
  await render({
    status: 'hostkey',
    hostKeyFingerprint: 'SHA256:test',
    logs,
  })
  const waiting = value()
  expect(waiting).toBe(0.6)
  await act(async () => vi.advanceTimersByTime(10000))
  expect(value()).toBe(waiting)
  await render({ status: 'error', currentStage: 'hostkey_confirm', errorCode: 'HOST_KEY_REJECTED', logs })
  await act(async () => vi.advanceTimersByTime(10000))
  expect(value()).toBe(waiting)
  await render({ status: 'connected', currentStage: 'ready', logs })
  expect(value()).toBe(1)
  expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100')
  await render({ status: 'reconnecting', currentStage: 'retry_wait', logs })
  expect(value()).toBe(0)
  await render({ currentStage: 'preparing', logs: [{ ...logs[0], at: Date.now() }] })
  expect(value()).toBeGreaterThan(0)
  expect(value()).toBeLessThan(waiting)
})

it('shows the actual failed stage, reason, code and actionable authentication advice once', async () => {
  const reconnect = vi.fn()
  await render({
    status: 'error',
    currentStage: 'ssh_auth',
    errorCode: 'SSH_AUTH_FAILED',
    errorMessage: '服务器未接受当前登录凭据',
    onReconnectNow: reconnect,
  })
  expect(document.querySelector('.connection-status')).toBeNull()
  expect(document.querySelector('.connection-failure-detail')).toBeNull()
  expect(document.querySelector('.connection-live-logs')?.textContent).toContain('登录认证未通过')
  expect(document.querySelector('.connection-live-logs')?.textContent).toContain('验证登录凭据')
  expect(document.querySelector('.connection-live-logs')?.textContent).toContain('SSH_AUTH_FAILED')
  expect(document.querySelector('.connection-log-suggestion')?.textContent).toContain('检查用户名')
  expect(document.body.textContent?.split('服务器未接受当前登录凭据')).toHaveLength(2)
  expect(document.querySelectorAll('.connection-live-logs [data-level="error"]')).toHaveLength(1)
  expect(document.querySelector('.connection-log-message svg')).not.toBeNull()
  await act(async () => button('重新连接').click())
  expect(reconnect).toHaveBeenCalledOnce()
})

it('falls back to the last real operation for an older failure snapshot without guessing its cause', async () => {
  await render({
    status: 'error',
    currentStage: 'failed',
    logs: [
      { at: 100, level: 'info', stage: 'establishing_ssh', message: '正在建立通道' },
      { at: 200, level: 'error', stage: 'failed', message: '未提供具体原因' },
    ],
  })
  expect(document.querySelector('.connection-live-logs')?.textContent).toContain('建立 SSH 通道')
  expect(document.querySelector('.connection-live-logs')?.textContent).toContain('连接未完成')
  expect(document.querySelector('.connection-live-logs')?.textContent).toContain('未提供具体原因')
  expect(document.querySelector('.connection-log-suggestion')?.textContent).not.toContain('密码')
})

it('expands readable records and copies diagnostic metadata with the safe backend messages', async () => {
  await render({
    status: 'error',
    currentStage: 'establishing_ssh',
    errorCode: 'SSH_CONNECTION_REFUSED',
    errorMessage: '目标端口拒绝连接',
    logs: [
      { at: 100, level: 'info', stage: 'resolve', message: '连接目标 example.test:22' },
      { at: 200, level: 'error', stage: 'establishing_ssh', message: '目标端口拒绝连接' },
    ],
  })
  const toggle = document.querySelector<HTMLButtonElement>('.connection-records-toggle')!
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  await act(async () => toggle.click())
  expect(document.querySelector('.connection-live-logs')).toBeNull()
  await act(async () => toggle.click())
  expect(document.querySelectorAll('.connection-live-logs li')).toHaveLength(2)
  expect(document.querySelector('.connection-live-logs')?.textContent).not.toContain('INFO')
  await act(async () => button('复制诊断信息').click())
  const text = vi.mocked(writeClipboardText).mock.calls[0][0]
  expect(text).toContain('连接：user@example.test:22')
  expect(text).toContain('错误码：SSH_CONNECTION_REFUSED')
  expect(text).toContain('阶段：建立 SSH 通道')
  expect(button('已复制')).toBeDefined()
  vi.mocked(writeClipboardText).mockRejectedValueOnce(new Error('unavailable'))
  await act(async () => button('已复制').click())
  expect(document.querySelector('.connection-live-logs li:last-child [role="alert"]')?.textContent).toContain(
    '复制失败',
  )
})

it('preserves all host verification decisions and never mistakes an error for a pending confirmation', async () => {
  const decide = vi.fn()
  const props = {
    status: 'hostkey' as const,
    currentStage: 'hostkey_confirm',
    hostKeyFingerprint: 'SHA256:current',
    knownHostKeyFingerprint: 'SHA256:known',
    onHostKeyDecision: decide,
  }
  await render(props)
  expect(document.querySelectorAll('.connection-fingerprint')).toHaveLength(2)
  expect(document.querySelector('.connection-live-logs [data-level="warn"]')?.textContent).toContain(
    '中间人攻击',
  )
  expect(document.querySelector('.connection-status')).toBeNull()
  for (const [label, decision] of [
    ['拒绝并断开', 'reject'],
    ['仅本次信任', 'trust_once'],
    ['更新指纹并继续', 'trust_permanently'],
  ]) {
    await act(async () => button(label).click())
    expect(decide).toHaveBeenLastCalledWith(decision)
  }
  await render({ ...props, status: 'error', errorCode: 'HOST_KEY_REJECTED' })
  expect(document.querySelector('.connection-host-key')).toBeNull()
  expect(document.querySelector('.connection-live-logs')?.textContent).toContain('主机身份未通过确认')
})
