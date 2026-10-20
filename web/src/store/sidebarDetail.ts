import { create } from 'zustand'

/**
 * Per-terminal view state for the workspace's server inspector.
 * Keyed by terminal tab id so each server connection owns an isolated cache.
 */
export interface DetailState {
  scrollTop: number
  expandedPaths: string[]
  /** Collapsed section flags. */
  filesCollapsed: boolean
  metricsCollapsed: boolean
  infoCollapsed: boolean
  /** Auto-navigate the file browser to the terminal's CWD when it changes. */
  followShellCwd: boolean
}

interface SidebarDetailStore {
  detailCache: Record<string, DetailState>

  getDetail: (tabId: string) => DetailState
  saveDetail: (tabId: string, patch: Partial<DetailState>) => void
  togglePath: (tabId: string, path: string) => void
  toggleFiles: (tabId: string) => void
  toggleMetrics: (tabId: string) => void
  toggleInfo: (tabId: string) => void
  toggleFollowShellCwd: (tabId: string) => void
  clearTab: (tabId: string) => void
}

const defaultDetail = (): DetailState => ({ scrollTop: 0, expandedPaths: [], filesCollapsed: false, metricsCollapsed: true, infoCollapsed: true, followShellCwd: true })

export const useSidebarDetailStore = create<SidebarDetailStore>((set, get) => ({
  detailCache: {},

  getDetail: (tabId) => get().detailCache[tabId] ?? defaultDetail(),

  saveDetail: (tabId, patch) =>
    set((s) => ({
      detailCache: {
        ...s.detailCache,
        [tabId]: { ...(s.detailCache[tabId] ?? defaultDetail()), ...patch },
      },
    })),

  togglePath: (tabId, path) =>
    set((s) => {
      const cur = s.detailCache[tabId] ?? defaultDetail()
      const expandedPaths = cur.expandedPaths.includes(path)
        ? cur.expandedPaths.filter((p) => p !== path)
        : [...cur.expandedPaths, path]
      return {
        detailCache: { ...s.detailCache, [tabId]: { ...cur, expandedPaths } },
      }
    }),

  toggleFiles: (tabId) =>
    set((s) => {
      const cur = s.detailCache[tabId] ?? defaultDetail()
      return {
        detailCache: { ...s.detailCache, [tabId]: { ...cur, filesCollapsed: !cur.filesCollapsed } },
      }
    }),

  toggleMetrics: (tabId) =>
    set((s) => {
      const cur = s.detailCache[tabId] ?? defaultDetail()
      const metricsCollapsed = !cur.metricsCollapsed
      return {
        detailCache: {
          ...s.detailCache,
          [tabId]: {
            ...cur,
            metricsCollapsed,
            infoCollapsed: metricsCollapsed ? cur.infoCollapsed : true,
          },
        },
      }
    }),

  toggleInfo: (tabId) =>
    set((s) => {
      const cur = s.detailCache[tabId] ?? defaultDetail()
      const infoCollapsed = !cur.infoCollapsed
      return {
        detailCache: {
          ...s.detailCache,
          [tabId]: {
            ...cur,
            metricsCollapsed: infoCollapsed ? cur.metricsCollapsed : true,
            infoCollapsed,
          },
        },
      }
    }),

  toggleFollowShellCwd: (tabId) =>
    set((s) => {
      const cur = s.detailCache[tabId] ?? defaultDetail()
      return {
        detailCache: { ...s.detailCache, [tabId]: { ...cur, followShellCwd: !cur.followShellCwd } },
      }
    }),

  clearTab: (tabId) =>
    set((s) => {
      const detailCache = { ...s.detailCache }
      delete detailCache[tabId]
      return { detailCache }
    }),

}))
