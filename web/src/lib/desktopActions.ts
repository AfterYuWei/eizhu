import { toast } from 'sonner'
import { useSessionStore } from '@/store/session'
import { useProfileStore } from '@/store/profile'
import { writeClipboardText } from './clipboard'
import { terminalActions } from './terminalActions'
import { workspaceGeneration } from './workspaceScope'
import type { Profile } from '@/types/profile'

export const desktopActions = [
  { id: 'sync-settings', label: '同步状态与冲突', key: 'y' },
  { id: 'account-settings', label: '账号设置', key: 'u' },
  { id: 'palette', label: '命令面板', key: 'k' },
  { id: 'new', label: '新建连接', key: 't' },
  { id: 'close', label: '关闭当前标签', key: 'w' },
  { id: 'sidebar', label: '展开或折叠侧栏', key: 'b' },
  { id: 'reconnect', label: '重连当前终端', key: 'r' },
  { id: 'sftp', label: '打开 SFTP 文件管理', key: 'e' },
  { id: 'copy-ssh', label: '复制 SSH 命令', key: 'c' },
  { id: 'snippets', label: '命令片段', key: 's' },
  { id: 'search', label: '查找终端内容', key: 'f' },
] as const
export type DesktopActionId = typeof desktopActions[number]['id']
const handlers = new Map<DesktopActionId, () => void | Promise<void>>()
const pending = new Set<string>()
export function registerDesktopAction(id: DesktopActionId, handler: () => void | Promise<void>) {
  handlers.set(id, handler)
  return () => { if (handlers.get(id) === handler) handlers.delete(id) }
}
export function shortcutAction(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'isComposing'>): DesktopActionId | undefined {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey || event.isComposing) return
  return desktopActions.find((a) => a.key === event.key.toLowerCase())?.id
}
function activeTerminal() {
  const store = useSessionStore.getState()
  return store.tabs.find((tab) => tab.id === store.activeTabId && tab.kind === 'terminal' && tab.profileId)
}
export function sshCommand(profile: Pick<Profile, 'host' | 'port' | 'username' | 'proxy' | 'options'>) {
  const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`
  if (!profile.host || !profile.username || !Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535
      || [profile.host, profile.username].some((s) => Array.from(s).some((c) => c.charCodeAt(0) < 32))) throw new Error('服务器连接信息无效')
  return {
    command: `ssh -p ${profile.port} -l ${quote(profile.username)} -- ${quote(profile.host)}`,
    incomplete: profile.proxy.type !== 'direct' || !['', '{}'].includes(profile.options),
  }
}
export async function executeDesktopAction(id: DesktopActionId, tabId?: string): Promise<void> {
  const store = useSessionStore.getState()
  if (tabId && id !== 'close') store.setActiveTab(tabId)
  const key = `${id}:${tabId ?? useSessionStore.getState().activeTabId ?? ''}`
  if (pending.has(key)) return
  const generation = workspaceGeneration()
  pending.add(key)
  try {
    const custom = handlers.get(id)
    if (custom) await custom()
    else if (id === 'new') useSessionStore.getState().openDraftTab()
    else if (id === 'close') { const active = tabId ?? useSessionStore.getState().activeTabId; if (active) useSessionStore.getState().closeTab(active) }
    else if (id === 'sftp') { const tab = activeTerminal(); useSessionStore.getState().openSftpTab(tab?.profileId, tab?.cwd) }
    else {
      const tab = activeTerminal()
      if (!tab) throw new Error('请先选择一个终端连接')
      const terminal = terminalActions(tab.id)
      if (id === 'copy-ssh') {
        const profile = useProfileStore.getState().profiles.find((p) => p.id === tab.profileId)
        if (!profile) throw new Error('找不到当前服务器配置')
        const result = sshCommand(profile)
        await writeClipboardText(result.command)
        if (generation === workspaceGeneration()) {
          if (result.incomplete) toast.warning('已复制基础 SSH 命令；代理、跳板和高级选项需另行配置，认证由本机 SSH 提供')
          else toast.success('已复制 SSH 命令；认证由本机 SSH 提供')
        }
      } else if (id === 'reconnect') {
        if (tab.status === 'connecting' || tab.status === 'reconnecting') return
        if (!terminal) throw new Error('终端尚未就绪')
        await terminal.reconnect()
      } else if (id === 'search') {
        if (!terminal) throw new Error('终端尚未就绪')
        terminal.search()
      }
    }
  } finally { pending.delete(key) }
}
export function runDesktopAction(id: DesktopActionId, tabId?: string) {
  void executeDesktopAction(id, tabId).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
}
export function focusActiveTerminal() { terminalActions(useSessionStore.getState().activeTabId)?.focus() }
