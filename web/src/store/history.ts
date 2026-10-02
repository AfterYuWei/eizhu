import { create } from 'zustand'
import { localStateApi, type HistoryEntry, type HistorySettings } from '@/api/localState'
import { workspaceGeneration } from '@/lib/workspaceScope'

const defaults: HistorySettings = { enabled: true, maxEntries: 500, retentionDays: 30 }
interface HistoryStore {
  settings: HistorySettings
  entries: Record<string, HistoryEntry[]>
  privateTabs: Record<string, boolean>
  loadSettings: () => Promise<void>
  load: (profileId: string) => Promise<void>
  configure: (settings: HistorySettings) => Promise<void>
  setPrivate: (tabId: string, enabled: boolean) => void
  record: (profileId: string, tabId: string, command: string, cwd?: string) => Promise<void>
  remove: (profileId?: string, id?: string) => Promise<void>
}
export const useHistoryStore = create<HistoryStore>((set, get) => ({
  settings: defaults, entries: {}, privateTabs: {},
  loadSettings: async () => {
    const generation = workspaceGeneration()
    const settings = await localStateApi.read<HistorySettings>('history_settings')
    if (generation === workspaceGeneration()) set({ settings: settings ?? defaults })
  },
  load: async (profileId) => {
    const generation = workspaceGeneration()
    const [entries, settings] = await Promise.all([localStateApi.history(profileId), localStateApi.read<HistorySettings>('history_settings')])
    if (generation !== workspaceGeneration()) return
    set((state) => ({ settings: settings ?? defaults, entries: { ...state.entries, [profileId]: entries } }))
  },
  configure: async (settings) => { const generation = workspaceGeneration(); await localStateApi.write('history_settings', settings); if (generation === workspaceGeneration()) set({ settings }) },
  setPrivate: (tabId, enabled) => set((state) => ({ privateTabs: { ...state.privateTabs, [tabId]: enabled } })),
  record: async (profileId, tabId, command, cwd) => {
    if (!profileId || !get().settings.enabled || get().privateTabs[tabId]) return
    const generation = workspaceGeneration()
    await localStateApi.record(profileId, command, cwd)
    if (generation === workspaceGeneration()) await get().load(profileId)
  },
  remove: async (profileId, id) => {
    const generation = workspaceGeneration()
    await localStateApi.remove(profileId, id)
    if (generation !== workspaceGeneration()) return
    if (profileId) await get().load(profileId)
    else set({ entries: {} })
  },
}))
