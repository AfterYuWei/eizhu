// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('./TerminalPane', () => ({ TerminalPane: ({ tab }: { tab: { id: string } }) => {
  const buffer = useRef(`buffer:${tab.id}`)
  return <textarea aria-label={`终端 ${tab.id}`} defaultValue={buffer.current} />
} }))
vi.mock('@/store/settings', () => ({ useSettingsStore: () => ({ terminalTheme: 'default' }), useResolvedTheme: () => 'dark' }))
vi.mock('./SplitControls', () => ({ SplitResizeHandle: () => null }))
vi.mock('@/components/Sftp/SftpView', () => ({ SftpView: () => <input aria-label="SFTP 页面状态" /> }))
vi.mock('@/components/Vault/VaultView', () => ({ VaultView: () => <input aria-label="密钥页面状态" /> }))
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

it('SSH、SFTP 和密钥页切换保留节点与输入，内容区域关联顶部 Tab', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useSessionStore.setState({ tabs: [
    { id: 'a', kind: 'terminal', profileId: 'p', profileName: '服务器', status: 'connected', sessionId: 'ssh' },
    { id: 's', kind: 'sftp', profileId: '', profileName: 'SFTP', status: 'disconnected', sessionId: null },
    { id: 'v', kind: 'vault', profileId: '', profileName: '密钥管理', status: 'connected', sessionId: null },
  ], activeTabId: 'a' })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => { root.render(<TerminalView />); await vi.dynamicImportSettled() })
    const inputs = [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')]
    inputs.forEach((input, index) => { input.value = `页面状态 ${index}` })
    for (const id of ['s', 'v', 'a']) {
      await act(async () => useSessionStore.getState().setActiveTab(id))
      expect([...host.querySelectorAll('input, textarea')]).toEqual(inputs)
      expect(host.querySelector(`#workspace-panel-${id}`)?.getAttribute('aria-labelledby')).toBe(`workspace-tab-${id}`)
    }
    expect(inputs.map((input) => input.value)).toEqual(['页面状态 0', '页面状态 1', '页面状态 2'])
    expect(useSessionStore.getState().tabs[0].sessionId).toBe('ssh')
  } finally {
    await act(async () => root.unmount()); host.remove()
  }
})
