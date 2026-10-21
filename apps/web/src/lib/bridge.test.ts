// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopApi } from '@eizhu/contracts'
import { bridge } from './bridge'
afterEach(() => { delete window.eizhu })
it('restores structured errors from a frozen contextBridge object without Proxy invariant failures', async () => {
  window.eizhu = Object.freeze({ group: Object.freeze({ list: () => Promise.reject({ code: 'WORKSPACE_CHANGED', message: '空间已变化', retryable: true }) }) }) as unknown as DesktopApi
  await expect(bridge().group.list()).rejects.toMatchObject({ error: { code: 'WORKSPACE_CHANGED' }, retryable: true })
})
it('sync subscription disposal stays synchronous and scoped to its callback', () => {
  const off = vi.fn()
  window.eizhu = Object.freeze({ events: Object.freeze({ on: () => off }) }) as unknown as DesktopApi
  const dispose = bridge().events.on('eizhu-runtime-state', () => {})
  dispose()
  expect(off).toHaveBeenCalledOnce()
})
it('browser preview exposes no desktop authority', () => {
  expect(() => bridge()).toThrow('此功能需要 eizhu 桌面客户端')
})
