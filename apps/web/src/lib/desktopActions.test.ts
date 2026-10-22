import { beforeEach, expect, it, vi } from 'vitest'
import { executeDesktopAction, shortcutAction, sshCommand } from './desktopActions'
import { registerTerminalActions } from './terminalActions'
import { resetWorkspaceView, useWorkspaceViewStore } from '@/store/workspaceView'
import { useSessionStore } from '@/store/session'
import { useProfileStore } from '@/store/profile'
import { writeClipboardText } from './clipboard'
import type { Profile } from '@/types/profile'
vi.mock('./clipboard', () => ({ writeClipboardText: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
beforeEach(async () => {
  await resetWorkspaceView()
  vi.resetAllMocks()
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useProfileStore.setState(useProfileStore.getInitialState(), true)
})
it('preserves remote control keys and ignores composing or Alt combinations', () => {
  const event = { key: 'k', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, isComposing: false }
  expect(shortcutAction(event)).toBeUndefined()
  expect(shortcutAction({ ...event, key: 'b' })).toBeUndefined()
  expect(shortcutAction({ ...event, key: 'K', shiftKey: true })).toBe('palette')
  expect(shortcutAction({ ...event, shiftKey: true, isComposing: true })).toBeUndefined()
  expect(shortcutAction({ ...event, shiftKey: true, altKey: true })).toBeUndefined()
  expect(shortcutAction({ ...event, key: 'S', shiftKey: true })).toBe('snippet-quick')
})
it('新建连接创建终端标签，SFTP 使用独立页面', async () => {
  await executeDesktopAction('new')
  await executeDesktopAction('sftp')
  expect(useSessionStore.getState().tabs).toHaveLength(1)
  expect(useWorkspaceViewStore.getState().activePage).toBe('sftp')
})
it('SSH command quotes operands, omits secrets and flags incomplete routing', () => {
  const result = sshCommand({ host: "h'; touch /tmp/injected", username: '中文', port: 2222, proxy: { type: 'jump' }, options: '' })
  expect(result.command).toBe("ssh -p 2222 -l '中文' -- 'h'\\''; touch /tmp/injected'")
  expect(result.incomplete).toBe(true)
})
it('copy errors propagate and reconnection is deduplicated until completion', async () => {
  const id = useSessionStore.getState().openDraftTab()
  useSessionStore.setState({ tabs: [{ id, profileId: 'p', profileName: 'p', sessionId: null, status: 'disconnected' }] })
  useProfileStore.setState({ profiles: [{ id: 'p', host: '::1', username: 'root', port: 22, proxy: { type: 'direct' }, options: '' } as Profile] })
  vi.mocked(writeClipboardText).mockRejectedValue(new Error('剪贴板不可用'))
  await expect(executeDesktopAction('copy-ssh')).rejects.toThrow('剪贴板不可用')
  let finish!: () => void
  const reconnect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  const unregister = registerTerminalActions(id, { reconnect, focus: vi.fn(), search: vi.fn(), insert: vi.fn(), safeMultiline: () => false })
  const first = executeDesktopAction('reconnect')
  await executeDesktopAction('reconnect')
  expect(reconnect).toHaveBeenCalledTimes(1)
  finish(); await first; unregister()
})

it('工具页关闭和终端快捷键不会操作后台终端；显式关闭后台标签仍可用', async () => {
  const id = useSessionStore.getState().openDraftTab()
  const before = useSessionStore.getState().tabs
  const actions = { reconnect: vi.fn(), focus: vi.fn(), search: vi.fn(), insert: vi.fn(), safeMultiline: () => false }
  const unregister = registerTerminalActions(id, actions)
  useWorkspaceViewStore.getState().openVault()
  for (const action of ['close', 'split-right', 'split-down', 'focus-next', 'focus-previous', 'maximize-pane', 'merge-panes', 'reconnect', 'search', 'copy-ssh'] as const) {
    await executeDesktopAction(action)
  }
  expect(useSessionStore.getState().tabs).toBe(before)
  expect(useWorkspaceViewStore.getState().activePage).toBe('vault')
  expect(actions.reconnect).not.toHaveBeenCalled()
  expect(actions.search).not.toHaveBeenCalled()
  await executeDesktopAction('close', id)
  expect(useSessionStore.getState().tabs).toHaveLength(0)
  expect(useWorkspaceViewStore.getState().activePage).toBe('vault')
  unregister()
})
