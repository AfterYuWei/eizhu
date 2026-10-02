import { create } from 'zustand'
import { syncApi } from '@/api/sync'
import type { SyncStatus, SyncConflict } from '@/types/sync'
interface SyncStore {
  status: SyncStatus | null
  conflicts: SyncConflict[]
  focusItem: { type: string; id: string } | null
  focusConflict: (type: string, id: string) => void
  refresh: () => Promise<void>
}
export const useSyncStore = create<SyncStore>((set) => ({
  status: null,
  conflicts: [],
  focusItem: null,
  focusConflict: (type, id) => set({ focusItem: { type, id } }),
  refresh: async () => {
    try {
      const [status, conflicts] = await Promise.all([syncApi.status(), syncApi.conflicts()])
      set({ status, conflicts })
    } catch { /* A workspace transition invalidates older results. */ }
  },
}))
