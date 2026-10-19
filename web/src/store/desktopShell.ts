import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

interface DesktopShellStore {
  serverRatio: number
  serversCollapsed: boolean
  openedCollapsed: boolean
  inspectorWidth: number
  collapsedGroups: Record<string, boolean>
  setServerRatio: (ratio: number) => void
  toggleServers: () => void
  toggleOpened: () => void
  setInspectorWidth: (width: number) => void
  toggleGroup: (id: string) => void
}

/** Only geometry is persisted; account-specific group IDs remain in memory. */
export const useDesktopShellStore = create<DesktopShellStore>()(persist((set) => ({
  serverRatio: 0.6,
  serversCollapsed: false,
  openedCollapsed: false,
  inspectorWidth: 320,
  collapsedGroups: {},
  setServerRatio: (ratio) => set({ serverRatio: clamp(ratio, 0.2, 0.8) }),
  toggleServers: () => set((s) => ({ serversCollapsed: !s.serversCollapsed })),
  toggleOpened: () => set((s) => ({ openedCollapsed: !s.openedCollapsed })),
  setInspectorWidth: (width) => set({ inspectorWidth: clamp(width, 280, 480) }),
  toggleGroup: (id) => set((s) => ({ collapsedGroups: { ...s.collapsedGroups, [id]: !s.collapsedGroups[id] } })),
}), {
  name: 'eizhu-desktop-shell',
  partialize: ({ serverRatio, serversCollapsed, openedCollapsed, inspectorWidth }) => ({ serverRatio, serversCollapsed, openedCollapsed, inspectorWidth }),
}))
