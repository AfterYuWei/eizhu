import { useWorkspaceViewStore } from '@/store/workspaceView';
import { useSessionStore } from '@/store/session';
import { workspaceGeneration } from './workspaceScope';
import { terminalActions } from './terminalActions';

export interface SnippetTarget { tabId: string; sessionId: string; generation?: number }
export function snippetTarget(): SnippetTarget | null {
  if (useWorkspaceViewStore.getState().activePage !== 'terminal') return null
  const store = useSessionStore.getState()
  const tab = store.tabs.find((t) => t.id === store.activeTabId && t.status === 'connected')
  return tab?.sessionId ? { tabId: tab.id, sessionId: tab.sessionId, generation: workspaceGeneration() } : null
}
export function multilineSnippet(content: string) { return /[\r\n]/.test(content) }
export function snippetTargetError(target: SnippetTarget | null): string | null {
  if (!target) return '请先选择已连接的终端，可继续搜索或复制片段'
  const tab = useSessionStore.getState().tabs.find((t) => t.id === target.tabId)
  if (workspaceGeneration() !== target.generation || tab?.sessionId !== target.sessionId || tab.status !== 'connected') return '目标终端已变化，请关闭后重新打开'
  if (!terminalActions(target.tabId)) return '目标终端尚未就绪，请稍后重新打开'
  return null
}
export function insertSnippet(target: SnippetTarget, content: string, execute = false) {
  const tab = useSessionStore.getState().tabs.find((t) => t.id === target.tabId)
  if (workspaceGeneration() !== target.generation || tab?.sessionId !== target.sessionId || tab.status !== 'connected') throw new Error('目标终端已变化，请重新选择')
  if (Array.from(content).some((c) => c.charCodeAt(0) < 32 && !['\t', '\r', '\n'].includes(c))) throw new Error('片段包含不支持的控制字符')
  const terminal = terminalActions(target.tabId)
  if (!terminal) throw new Error('目标终端尚未就绪')
  if (multilineSnippet(content) && !terminal.safeMultiline()) throw new Error('未启用安全的多行粘贴，请复制后自行处理')
  useSessionStore.getState().setActiveTab(target.tabId)
  terminal.insert(content.replace(/\r\n?/g, '\n'), execute)
}
