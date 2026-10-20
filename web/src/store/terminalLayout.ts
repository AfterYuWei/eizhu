import { create } from 'zustand'
import { useSessionStore, type SessionTab } from './session'
import { useProfileStore } from './profile'
import { localStateApi } from '@/api/localState'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { isMobileRuntime } from '@/lib/platform'
import { terminalActions } from '@/lib/terminalActions'
import { leaves, replaceLeaf, pruneTree, setRatio, parseSplitTree, type SplitTree, type SplitAxis } from '@/lib/terminalLayout'
import { toast } from 'sonner'
interface LayoutState {
  tree: SplitTree | null; focusedId: string | null; maximizedId: string | null; ready: boolean
  split: (axis: SplitAxis) => void
  focusNext: (direction: number) => void
  maximize: () => void
  merge: () => void
  resize: (id: string, ratio: number) => void
}
let mutating = false
let timer: ReturnType<typeof setTimeout> | undefined
let savedSnapshot = ''
let bootGeneration: number | undefined
export const useTerminalLayoutStore = create<LayoutState>((set, get) => ({
  tree: null, focusedId: null, maximizedId: null, ready: false,
  split: (axis) => {
    syncTerminalLayout()
    const { tree, focusedId } = get()
    const active = useSessionStore.getState().tabs.find((tab) => tab.id === focusedId)
    if (!tree || !active || active.kind !== 'terminal') throw new Error('请先选择一个终端标签')
    if (leaves(tree).length >= 4) throw new Error('每个布局最多四个窗格')
    mutating = true
    const newId = useSessionStore.getState().openDraftTab()
    mutating = false
    set({ tree: replaceLeaf(tree, active.id, { type: 'split', id: crypto.randomUUID(), axis, ratio: 0.5, first: { type: 'leaf', tabId: active.id }, second: { type: 'leaf', tabId: newId } }), focusedId: newId, maximizedId: null })
  },
  focusNext: (direction) => {
    const { tree, focusedId } = get(), ids = leaves(tree)
    if (!ids.length) return
    const id = ids[(ids.indexOf(focusedId ?? '') + direction + ids.length) % ids.length]
    set({ focusedId: id, ...(get().maximizedId ? { maximizedId: id } : {}) })
    useSessionStore.getState().setActiveTab(id); terminalActions(id)?.focus()
  },
  maximize: () => set({ maximizedId: get().maximizedId ? null : get().focusedId }),
  merge: () => { const id = get().focusedId; if (id) set({ tree: { type: 'leaf', tabId: id }, maximizedId: null }) },
  resize: (id, ratio) => { const tree = get().tree; if (tree && Number.isFinite(ratio)) set({ tree: setRatio(tree, id, ratio) }) },
}))
function syncTerminalLayout() {
  if (mutating) return
  const sessions = useSessionStore.getState(), layout = useTerminalLayoutStore.getState()
  const active = sessions.tabs.find((tab) => tab.id === sessions.activeTabId && tab.kind === 'terminal')
  const allowed = new Set(sessions.tabs.filter((tab) => tab.kind === 'terminal').map((tab) => tab.id))
  let tree = pruneTree(layout.tree, allowed)
  if (active && !leaves(tree).includes(active.id)) {
    tree = tree && layout.focusedId && leaves(tree).includes(layout.focusedId)
      ? replaceLeaf(tree, layout.focusedId, { type: 'leaf', tabId: active.id }) : { type: 'leaf', tabId: active.id }
  }
  const focusedId = active?.id ?? (allowed.has(layout.focusedId ?? '') ? layout.focusedId : leaves(tree)[0] ?? null)
  if (tree !== layout.tree || focusedId !== layout.focusedId) useTerminalLayoutStore.setState({ tree, focusedId, maximizedId: layout.maximizedId && active ? active.id : null })
}
function scheduleSave() {
  const { ready } = useTerminalLayoutStore.getState()
  if (!ready || isMobileRuntime()) return
  if (timer) clearTimeout(timer)
  const generation = workspaceGeneration()
  timer = setTimeout(() => {
    if (generation !== workspaceGeneration()) return
    const { tree, focusedId } = useTerminalLayoutStore.getState()
    const sessions = useSessionStore.getState().tabs.filter((tab) => tab.kind === 'terminal')
    const visible = new Set(leaves(tree))
    const tabs = [...sessions.filter((tab) => visible.has(tab.id)), ...sessions.filter((tab) => !visible.has(tab.id))].slice(0, 128).map(({ id, profileId }) => ({ id, profileId }))
    const snapshot = { version: 1, tree, focusedId, tabs }
    const serialized = JSON.stringify(snapshot)
    if (serialized === savedSnapshot) return
    void localStateApi.write('terminal_layout', snapshot).then(() => { if (generation === workspaceGeneration()) savedSnapshot = serialized }).catch(() => {
      if (generation === workspaceGeneration()) toast.error('终端布局保存失败，可继续使用当前布局')
    })
  }, 250)
}
useSessionStore.subscribe((state, previous) => { if (state.tabs !== previous.tabs || state.activeTabId !== previous.activeTabId) { syncTerminalLayout(); scheduleSave() } })
useTerminalLayoutStore.subscribe(scheduleSave)
export function resetTerminalLayout() {
  if (timer) clearTimeout(timer)
  savedSnapshot = ''
  bootGeneration = undefined
  useTerminalLayoutStore.setState(useTerminalLayoutStore.getInitialState(), true)
}
export async function restoreTerminalLayout() {
  const generation = workspaceGeneration()
  if (isMobileRuntime() || generation === undefined || bootGeneration === generation) return
  bootGeneration = generation
  try {
    const snapshot = await localStateApi.read<{ version: number; tree: unknown; focusedId?: string; tabs?: { id: string; profileId: string }[] }>('terminal_layout')
    if (generation !== workspaceGeneration()) return
    if (snapshot?.version === 1 && Array.isArray(snapshot.tabs) && useSessionStore.getState().tabs.length === 0) {
      const profiles = useProfileStore.getState().profiles, seen = new Set<string>()
      const tabs: SessionTab[] = snapshot.tabs.slice(0, 128).flatMap((reference) => {
        if (!reference || typeof reference.id !== 'string' || reference.id.length > 128 || seen.has(reference.id)) return []
        seen.add(reference.id)
        const profile = profiles.find((profile) => profile.id === reference.profileId)
        return [{ id: reference.id, kind: 'terminal', profileId: profile?.id ?? '', profileName: profile?.name ?? '选择服务器', host: profile?.host, port: profile?.port, username: profile?.username, status: 'disconnected', sessionId: null, manualConnect: true }]
      })
      const tree = parseSplitTree(snapshot.tree, new Set(tabs.map((tab) => tab.id)))
      const focusedId = leaves(tree).includes(snapshot.focusedId ?? '') ? snapshot.focusedId! : leaves(tree)[0] ?? tabs[0]?.id ?? null
      mutating = true
      useSessionStore.setState({ tabs, activeTabId: focusedId }); mutating = false
      useTerminalLayoutStore.setState({ tree, focusedId })
    }
  } catch { if (generation === workspaceGeneration()) toast.warning('无法读取本地布局，请手动打开连接') }
  if (generation === workspaceGeneration()) { syncTerminalLayout(); useTerminalLayoutStore.setState({ ready: true }) }
}
