// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('./TerminalPane', () => ({ TerminalPane: ({ tab }: { tab: { id: string } }) => {
  const buffer = useRef(`buffer:${tab.id}`)
  return <textarea aria-label={`终端 ${tab.id}`} defaultValue={buffer.current} />
} }))
vi.mock('@/store/settings', () => ({ useSettingsStore: () => ({ terminalTheme: 'default' }), useResolvedTheme: () => 'dark' }))
vi.mock('./SplitControls', () => ({ SplitToolbar: () => null, SplitResizeHandle: () => null }))
import { TerminalView } from './index'
import { useSessionStore } from '@/store/session'
import { useTerminalLayoutStore, resetTerminalLayout } from '@/store/terminalLayout'
afterEach(() => { resetTerminalLayout(); useSessionStore.setState(useSessionStore.getInitialState(), true) })
it('布局、最大化和合并不卸载终端节点或丢失已有缓冲', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useSessionStore.setState({ tabs: [{ id: 'a', kind: 'terminal', profileId: 'p', profileName: 'p', status: 'connected', sessionId: 'ssh' }], activeTabId: 'a' })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => { root.render(<TerminalView />); await vi.dynamicImportSettled() })
  const terminal = host.querySelector<HTMLTextAreaElement>('[aria-label="终端 a"]')!
  terminal.value = '旧终端缓冲与输入'
  await act(async () => useTerminalLayoutStore.getState().split('horizontal'))
  await act(async () => useTerminalLayoutStore.getState().maximize())
  await act(async () => useTerminalLayoutStore.getState().merge())
  expect(host.querySelector('[aria-label="终端 a"]')).toBe(terminal)
  expect(terminal.value).toBe('旧终端缓冲与输入')
  expect(useSessionStore.getState().tabs[0].sessionId).toBe('ssh')
  await act(async () => root.unmount()); host.remove()
})
