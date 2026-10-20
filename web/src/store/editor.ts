import { create } from 'zustand'
import { editApi } from '@/api/edit'
import type { LineEnding } from '@/types/sftp'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { toast } from 'sonner'

export type EditorSessionType = 'sftp' | 'serverDetail'
export interface MergePreview { openingContent: string; localContent: string; remoteContent: string; modTime: string; contentHash?: string }
export interface EditorTab {
  id: string; sessionId: string; sessionType: EditorSessionType; path: string; filename: string
  content: string; originalContent: string; openedContent: string; modTime: string | null; contentHash?: string
  language: string; lineEnding: LineEnding; readOnly: boolean; loading: boolean; saving: boolean
  error: string | null; conflict: boolean; mergePreview: MergePreview | null; readEpoch: number
}
interface EditorStore {
  open: boolean; tabs: EditorTab[]; activeTabId: string | null
  openFile: (sessionId: string, sessionType: EditorSessionType, path: string) => Promise<void>
  closeTab: (id: string) => void; closeAll: () => void; setActiveTab: (id: string) => void
  setContent: (id: string, content: string) => void; setLanguage: (id: string, language: string) => void
  saveFile: (id: string) => Promise<boolean>; saveAs: (id: string, path: string) => Promise<boolean>
  reloadFile: (id: string) => Promise<void>; compareFile: (id: string) => Promise<void>
  mergeFile: (id: string, content: string) => void; dismissMerge: (id: string) => void
}
const normalize = (content: string) => content.replace(/\r\n?/g, '\n')
const filename = (path: string) => path.split('/').at(-1) || path
function message(error: unknown) { const e = error as { error?: { message?: string }; message?: string }; return e?.error?.message ?? e?.message ?? '文件操作失败' }
function code(error: unknown) { return (error as { error?: { code?: string } })?.error?.code ?? '' }
export const useEditorStore = create<EditorStore>((set, get) => {
  const update = (id: string, patch: Partial<EditorTab> | ((tab: EditorTab) => Partial<EditorTab>)) => set((s) => ({ tabs: s.tabs.map((t) => t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t) }))
  const current = (id: string, generation: number | undefined) => generation === workspaceGeneration() && get().tabs.some((t) => t.id === id)
  const save = async (id: string, target?: string): Promise<boolean> => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab || tab.saving || tab.loading || (!target && tab.readOnly)) return false
    if (!target && tab.content === tab.originalContent) return true
    if (!target && !tab.modTime) return false
    const generation = workspaceGeneration()
    const content = tab.content
    update(id, { saving: true })
    try {
      const response = await editApi.writeFile(tab.sessionId, target ?? tab.path, { content, expected_mod_time: target ? '' : tab.modTime!, expected_content_hash: target ? undefined : tab.contentHash, create_new: !!target, line_ending: tab.lineEnding })
      if (!current(id, generation)) return false
      update(id, (t) => ({ originalContent: content, modTime: response.mod_time, contentHash: response.content_hash, saving: false, conflict: false, error: null, mergePreview: null, readEpoch: t.readEpoch + 1, ...(target ? { path: response.path, filename: filename(response.path), readOnly: false } : {}) }))
      toast.success('已保存')
      return true
    } catch (error) {
      if (!current(id, generation)) return false
      const conflict = code(error) === 'FILE_MODIFIED'
      update(id, { saving: false, conflict, error: message(error) })
      if (conflict && !target) { toast.warning('远端已变化，本地内容已保留，请手动合并'); await get().compareFile(id) }
      else toast.error(message(error))
      return false
    }
  }
  return {
    open: false, tabs: [], activeTabId: null,
    openFile: async (sessionId, sessionType, path) => {
      const existing = get().tabs.find((t) => t.sessionId === sessionId && t.path === path)
      if (existing) { set({ activeTabId: existing.id, open: true }); return }
      const id = `editor-${crypto.randomUUID()}`
      const generation = workspaceGeneration()
      const tab: EditorTab = { id, sessionId, sessionType, path, filename: filename(path), content: '', originalContent: '', openedContent: '', modTime: null, language: 'plaintext', lineEnding: 'lf', readOnly: false, loading: true, saving: false, error: null, conflict: false, mergePreview: null, readEpoch: 0 }
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id, open: true }))
      try {
        const response = await editApi.readFile(sessionId, path)
        if (!current(id, generation)) return
        const content = normalize(response.content)
        update(id, { content, originalContent: content, openedContent: content, modTime: response.mod_time, contentHash: response.content_hash, language: response.language, lineEnding: response.line_ending, readOnly: response.read_only, loading: false })
      } catch (error) {
        if (!current(id, generation)) return
        toast.error(message(error)); get().closeTab(id)
      }
    },
    closeTab: (id) => set((s) => { const tabs = s.tabs.filter((t) => t.id !== id); return { tabs, activeTabId: s.activeTabId === id ? tabs.at(-1)?.id ?? null : s.activeTabId, open: tabs.length > 0 } }),
    closeAll: () => set({ tabs: [], activeTabId: null, open: false }),
    setActiveTab: (activeTabId) => set({ activeTabId }),
    setContent: (id, content) => update(id, { content: normalize(content) }),
    setLanguage: (id, language) => update(id, { language }),
    saveFile: (id) => save(id),
    saveAs: (id, path) => path.trim() ? save(id, path.trim()) : Promise.resolve(false),
    compareFile: async (id) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab || tab.loading || tab.saving) return
      const generation = workspaceGeneration()
      const epoch = tab.readEpoch + 1
      update(id, { readEpoch: epoch })
      try {
        const remote = await editApi.readFile(tab.sessionId, tab.path)
        if (!current(id, generation) || get().tabs.find((t) => t.id === id)?.readEpoch !== epoch) return
        update(id, (t) => ({ mergePreview: { openingContent: t.openedContent, localContent: t.content, remoteContent: normalize(remote.content), modTime: remote.mod_time, contentHash: remote.content_hash } }))
      } catch (error) { if (current(id, generation)) { update(id, { error: message(error) }); toast.error(message(error)) } }
    },
    mergeFile: (id, content) => update(id, (t) => t.mergePreview ? { content: normalize(content), originalContent: t.mergePreview.remoteContent, modTime: t.mergePreview.modTime, contentHash: t.mergePreview.contentHash, mergePreview: null, conflict: false, error: null } : {}),
    dismissMerge: (id) => update(id, { mergePreview: null }),
    reloadFile: async (id) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab || tab.saving) return
      const generation = workspaceGeneration()
      const epoch = tab.readEpoch + 1
      update(id, { loading: true, readEpoch: epoch })
      try {
        const remote = await editApi.readFile(tab.sessionId, tab.path)
        if (!current(id, generation) || get().tabs.find((t) => t.id === id)?.readEpoch !== epoch) return
        const content = normalize(remote.content)
        update(id, { content, originalContent: content, openedContent: content, modTime: remote.mod_time, contentHash: remote.content_hash, language: remote.language, lineEnding: remote.line_ending, readOnly: remote.read_only, loading: false, error: null, conflict: false, mergePreview: null })
      } catch (error) { if (current(id, generation)) { update(id, { loading: false, error: message(error) }); toast.error(message(error)) } }
    },
  }
})
export function useActiveTab(): EditorTab | null { return useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null) }
