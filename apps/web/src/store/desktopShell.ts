import { create } from 'zustand'
import { settingsStorage } from '@/lib/settingsStorage'
import { createJSONStorage,persist } from 'zustand/middleware'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

interface DesktopShellStore {
  serversCollapsed: boolean
  inspectorWidth: number
  collapsedGroups: Record<string, boolean>
  toggleServers: () => void
  setInspectorWidth: (width: number) => void
  toggleGroup: (id: string) => void
}

/** Only geometry is persisted; account-specific group IDs remain in memory. */
export const useDesktopShellStore = create<DesktopShellStore>()(persist((set) => ({
  serversCollapsed: false,
  inspectorWidth: 320,
  collapsedGroups: {},
  toggleServers: () => set((s) => ({ serversCollapsed: !s.serversCollapsed })),
  setInspectorWidth: (width) => set({ inspectorWidth: clamp(width, 280, 480) }),
  toggleGroup: (id) => set((s) => ({ collapsedGroups: { ...s.collapsedGroups, [id]: !s.collapsedGroups[id] } })),
}), {
  name: 'eizhu-desktop-shell',
  storage: createJSONStorage(() => settingsStorage),
  partialize: ({ serversCollapsed, inspectorWidth }) => ({ serversCollapsed, inspectorWidth }),
  // Older preferences may still contain the removed split-list fields.
  merge: (persisted, current) => {
    const saved = persisted as Partial<DesktopShellStore> | undefined
    return { ...current,
      serversCollapsed: typeof saved?.serversCollapsed === 'boolean' ? saved.serversCollapsed : current.serversCollapsed,
      inspectorWidth: typeof saved?.inspectorWidth === 'number' && Number.isFinite(saved.inspectorWidth) ? clamp(saved.inspectorWidth, 280, 480) : current.inspectorWidth,
    }
  },
}))
