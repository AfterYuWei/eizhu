import { invoke } from '@tauri-apps/api/core'
import { useProfileStore } from '@/store/profile'
import { useVaultStore } from '@/store/vault'
import { useSessionStore } from '@/store/session'
import { useEditorStore } from '@/store/editor'
import { useServerDetailStore } from '@/store/serverDetail'
import { useSyncStore } from '@/store/sync'
import { useHistoryStore } from '@/store/history'
export interface WorkspaceStatus { id: string; generation: number; userId: number }
import { workspaceGeneration, setWorkspaceGeneration } from './workspaceScope'
export { workspaceGeneration } from './workspaceScope'
export function applyWorkspace(workspace: WorkspaceStatus) {
  if (workspaceGeneration() === workspace.generation) return
  setWorkspaceGeneration(workspace.generation)
  useProfileStore.setState(useProfileStore.getInitialState(), true)
  useVaultStore.setState(useVaultStore.getInitialState(), true)
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useEditorStore.setState(useEditorStore.getInitialState(), true)
  useServerDetailStore.setState(useServerDetailStore.getInitialState(), true)
  useSyncStore.setState(useSyncStore.getInitialState(), true)
  useHistoryStore.setState(useHistoryStore.getInitialState(), true)
  void useProfileStore.getState().refreshAll()
  void useVaultStore.getState().fetchList()
  void useSyncStore.getState().refresh()
}
export async function refreshWorkspace() { applyWorkspace(await invoke<WorkspaceStatus>('workspace_status')) }
