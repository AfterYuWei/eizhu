import { create } from 'zustand'
import { createJSONStorage,persist } from 'zustand/middleware'
import { settingsStorage } from '@/lib/settingsStorage'
import { DEFAULT_DESKTOP_SIDEBAR_WIDTH } from '@/lib/desktopSidebar'
import { buildChannel } from '@/lib/updater'

type Theme = 'light' | 'dark' | 'system'
export type { UpdateChannel } from '@eizhu/contracts'
import type { UpdateChannel } from '@eizhu/contracts'

const DEFAULT_UPDATE_CHANNEL = buildChannel
export const DEFAULT_DESKTOP_TERMINAL_FONT_SIZE = 13

interface SettingsStore {
  theme: Theme
  /** 桌面终端字号。 */
  fontSize: number
  fontFamily: string
  fontFamilyCN: string
  sidebarWidth: number
  appFontSize: number
  appFontFamily: string
  terminalTheme: string
  // 自动补全设置
  terminalAutocomplete: boolean
  terminalInlineSuggestion: boolean
  terminalPopupMenu: boolean
  updateChannel: UpdateChannel
  // system 模式下系统主题变化时自增，用于触发组件重渲染（theme 仍为 'system'）
  systemRevision: number

  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setFontSize: (size: number) => void
  setFontFamily: (family: string) => void
  setFontFamilyCN: (family: string) => void
  setSidebarWidth: (width: number) => void
  setAppFontSize: (size: number) => void
  setAppFontFamily: (family: string) => void
  setTerminalTheme: (id: string) => void
  setTerminalAutocomplete: (enabled: boolean) => void
  setTerminalInlineSuggestion: (enabled: boolean) => void
  setTerminalPopupMenu: (enabled: boolean) => void
  setUpdateChannel: (channel: UpdateChannel) => void
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export const DEFAULT_APP_FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Inter', 'Noto Sans SC', system-ui, sans-serif"

function applyAppFont(appFontSize: number, appFontFamily: string) {
  const root = document.documentElement
  root.style.setProperty('--sans-size', `${appFontSize}px`)
  root.style.setProperty('--sans', appFontFamily)
  // 同步 Tailwind @theme 变量
  root.style.setProperty('--font-sans', appFontFamily)
}

function applySidebarWidth(sidebarWidth: number) {
  document.documentElement.style.setProperty('--sidebar-w', `${sidebarWidth}px`)
}

function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme)
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
}

// Watch OS-level theme changes so "system" mode reacts in real time.
// 关键：系统主题变化时不仅要切换 DOM class，还要触发 store 状态更新，
// 这样依赖 useSettingsStore 的组件（如 ThemeToggle 图标）才能重渲染。
// 用一个自增的 systemRevision 强制订阅者感知变化（theme 字符串仍是 'system' 不变）。
let systemWatcher: ((e: MediaQueryListEvent) => void) | null = null
function ensureSystemWatcher() {
  if (systemWatcher) return
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (e: MediaQueryListEvent) => {
    const { theme } = useSettingsStore.getState()
    if (theme === 'system') {
      const root = document.documentElement
      root.classList.remove('light', 'dark')
      root.classList.add(e.matches ? 'dark' : 'light')
      // 触发 store 更新，让组件重渲染（图标跟随系统深浅变化）
      useSettingsStore.setState((s) => ({ systemRevision: s.systemRevision + 1 }))
    }
  }
  mql.addEventListener('change', handler)
  systemWatcher = handler
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      theme: 'system',
      fontSize: DEFAULT_DESKTOP_TERMINAL_FONT_SIZE,
      fontFamily: "'JetBrains Mono'",
      fontFamilyCN: "'Noto Sans SC'",
      sidebarWidth: DEFAULT_DESKTOP_SIDEBAR_WIDTH,
      appFontSize: 14,
      appFontFamily: DEFAULT_APP_FONT_FAMILY,
      terminalTheme: 'default',
      terminalAutocomplete: true,
      terminalInlineSuggestion: false,
      terminalPopupMenu: true,
      updateChannel: DEFAULT_UPDATE_CHANNEL,
      systemRevision: 0,

      setTheme: (theme) => {
        set({ theme })
        applyTheme(theme)
      },
      toggleTheme: () => {
        const current = resolveTheme(get().theme)
        const next = current === 'dark' ? 'light' : 'dark'
        set({ theme: next })
        applyTheme(next)
      },
      setFontSize: (fontSize) => set({ fontSize }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setFontFamilyCN: (fontFamilyCN) => set({ fontFamilyCN }),
      setSidebarWidth: (sidebarWidth) => {
        set({ sidebarWidth })
        applySidebarWidth(sidebarWidth)
      },
      setAppFontSize: (appFontSize) => {
        set({ appFontSize })
        applyAppFont(appFontSize, get().appFontFamily)
      },
      setAppFontFamily: (appFontFamily) => {
        set({ appFontFamily })
        applyAppFont(get().appFontSize, appFontFamily)
      },
      setTerminalTheme: (terminalTheme) => set({ terminalTheme }),
      setTerminalAutocomplete: (terminalAutocomplete) => set({ terminalAutocomplete }),
      setTerminalInlineSuggestion: (terminalInlineSuggestion) => set({ terminalInlineSuggestion }),
      setTerminalPopupMenu: (terminalPopupMenu) => set({ terminalPopupMenu }),
      setUpdateChannel: (updateChannel) => set({ updateChannel }),
    }),
    {
      name: 'eizhu-settings',
      version: 1,
      storage: createJSONStorage(() => settingsStorage),

    }
  )
)

// Apply theme on load
export function initTheme() {
  const state = useSettingsStore.getState()
  applyTheme(state.theme)
  applyAppFont(state.appFontSize, state.appFontFamily)
  applySidebarWidth(state.sidebarWidth)
  ensureSystemWatcher()
}

/** 解析当前生效主题（'system' 实时跟随系统深浅色，经 systemRevision 触发重渲染）。 */
export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useSettingsStore((state) => state.theme)
  // 订阅 revision：系统深浅切换时 store 自增，本组件随之重渲染重新求值
  useSettingsStore((state) => state.systemRevision)
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}
