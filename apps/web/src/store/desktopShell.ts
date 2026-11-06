import type { SettingsTab } from '@/components/SettingsDialog'
import { create } from 'zustand'
import { settingsStorage } from '@/lib/settingsStorage'
import { createJSONStorage,persist } from 'zustand/middleware'
import { sidebarGroupsSchema } from '@eizhu/contracts'
import { localStateApi } from '@/api/localState'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { toast } from 'sonner'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

interface DesktopShellStore {
  settingsPage: SettingsTab | null
  setSettingsPage: (tab: SettingsTab | null) => void
  inspectorWidth: number
  collapsedGroups: Record<string, boolean>
  groupsReady: boolean
  setInspectorWidth: (width: number) => void
  toggleGroup: (id: string) => void
}

/** Geometry is global; group expansion is stored in the workspace's local state. */
export const useDesktopShellStore = create<DesktopShellStore>()(persist((set) => ({
  settingsPage: null,
  setSettingsPage: (settingsPage) => set({ settingsPage }),
  inspectorWidth: 400,
  collapsedGroups: {},
  groupsReady: false,
  setInspectorWidth: (width) => set({ inspectorWidth: clamp(width, 320, 560) }),
  toggleGroup: (id) => set((s) => ({ collapsedGroups: { ...s.collapsedGroups, [id]: !s.collapsedGroups[id] } })),
}), {
  name: 'eizhu-desktop-shell',
  storage: createJSONStorage(() => settingsStorage),
  partialize: ({ inspectorWidth }) => ({ inspectorWidth }),
  // Older preferences may still contain the removed split-list fields.
  merge: (persisted, current) => {
    const saved = persisted as (Partial<DesktopShellStore> & { aiWidth?: number }) | undefined
    return { ...current,
      inspectorWidth: typeof saved?.aiWidth === 'number' && Number.isFinite(saved.aiWidth) ? clamp(saved.aiWidth, 320, 560) : typeof saved?.inspectorWidth === 'number' && Number.isFinite(saved.inspectorWidth) ? clamp(saved.inspectorWidth, 320, 560) : current.inspectorWidth,
    }
  },
}))

useDesktopShellStore.subscribe((state, previous) => {
  const generation = workspaceGeneration()
  if (!state.groupsReady || state.collapsedGroups === previous.collapsedGroups || generation === undefined) return
  void localStateApi.write('sidebar_groups', state.collapsedGroups).catch(() => {
    if (generation === workspaceGeneration()) toast.error('文件夹展开状态保存失败，请重试')
  })
})

export async function restoreSidebarGroups() {
  const generation = workspaceGeneration()
  if (generation === undefined) return
  try {
    const saved = sidebarGroupsSchema.parse(await localStateApi.read('sidebar_groups') ?? {})
    if (generation !== workspaceGeneration()) return
    // Preserve clicks made while the workspace preferences were loading.
    useDesktopShellStore.setState((state) => ({ collapsedGroups: { ...saved, ...state.collapsedGroups }, groupsReady: true }))
  } catch {
    if (generation === workspaceGeneration()) toast.warning('无法读取文件夹展开状态，本次调整将不会保存')
  }
}
