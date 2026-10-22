import { resetTerminalLayout,restoreTerminalLayout } from '@/store/terminalLayout'
import { bridge } from './bridge'
import { useProfileStore } from '@/store/profile'
import { useVaultStore } from '@/store/vault'
import { resetWorkspaceView } from '@/store/workspaceView'
import { useSessionStore } from '@/store/session'
import { useEditorStore } from '@/store/editor'
import { useServerDetailStore } from '@/store/serverDetail'
import { useSyncStore } from '@/store/sync'
import { useHistoryStore } from '@/store/history'
import { useSidebarDetailStore } from '@/store/sidebarDetail'
import { useDesktopShellStore } from '@/store/desktopShell'
import { workspaceGeneration,setWorkspaceGeneration } from './workspaceScope'
import { resetSnippetQuickAccess } from './snippetQuickAccess'
export interface WorkspaceStatus { id: string; generation: number; userId: number }
export { workspaceGeneration } from './workspaceScope'
export function applyWorkspace(workspace: WorkspaceStatus) {
  if (workspaceGeneration() === workspace.generation) return
  void resetWorkspaceView().catch((error: unknown) => console.error('释放旧工作空间文件资源失败', error))
  resetTerminalLayout()
  setWorkspaceGeneration(workspace.generation)
  resetSnippetQuickAccess()
  useProfileStore.setState(useProfileStore.getInitialState(), true)
  useVaultStore.setState(useVaultStore.getInitialState(), true)
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useEditorStore.setState(useEditorStore.getInitialState(), true)
  useServerDetailStore.setState(useServerDetailStore.getInitialState(), true)
  useSyncStore.setState(useSyncStore.getInitialState(), true)
  useHistoryStore.setState(useHistoryStore.getInitialState(), true)
  useSidebarDetailStore.setState(useSidebarDetailStore.getInitialState(), true)
  useDesktopShellStore.setState({ collapsedGroups: {} })
  void useProfileStore.getState().refreshAll().then(() => { if (workspaceGeneration() === workspace.generation) return restoreTerminalLayout() }).catch(() => {})
  void useVaultStore.getState().fetchList()
  void useSyncStore.getState().refresh()
}
export async function refreshWorkspace() { applyWorkspace(await bridge().workspace.status()) }
