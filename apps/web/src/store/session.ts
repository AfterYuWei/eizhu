import { create } from 'zustand'
import { useWorkspaceViewStore } from './workspaceView'
import { sessionApi } from '@/api/session'
import { useServerDetailStore } from '@/store/serverDetail'
import type { SessionApiError } from '@/types/session'

export type TabStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting'

export interface SessionTab {
  id: string
  profileId: string
  profileName: string
  sessionId: string | null
  status: TabStatus
  host?: string
  port?: number
  username?: string
  cwd?: string
  latency?: number
  errorReason?: string
  errorMessage?: string
  reconnectAttempt?: number
  nextRetryAt?: number
  hostKeyFingerprint?: string
  knownHostKeyFingerprint?: string
  manualConnect?: boolean
  detailAttached?: boolean
}

interface SessionStore {
  tabs: SessionTab[]
  activeTabId: string | null
  loading: boolean
  openTab: (
    profileId: string,
    profileName: string,
    host?: string,
    port?: number,
    username?: string,
    targetTabId?: string,
  ) => Promise<string>
  openDraftTab: () => string
  cancelConnection: (tabId: string) => Promise<void>
  closeTab: (tabId: string) => Promise<void>
  setActiveTab: (tabId: string) => void
  updateTabStatus: (tabId: string, status: TabStatus, sessionId?: string) => void
  updateTabCwd: (tabId: string, cwd: string) => void
  updateTabLatency: (tabId: string, latency: number) => void
  fetchSessions: () => Promise<void>
  markTabError: (tabId: string, reason: string, message: string) => void
  markTabReconnecting: (tabId: string, attempt: number, nextRetryAt: number) => void
  clearTabError: (tabId: string) => void
  setTabHostKeyPrompt: (tabId: string, hostFingerprint: string, knownHostFingerprint?: string) => void
  clearTabHostKeyPrompt: (tabId: string) => void
}

function isHostKeyChangedError(err: SessionApiError): boolean {
  return err?.error?.code === 'HOST_KEY_CHANGED' && !!err.host_fingerprint
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  loading: false,

  openTab: async (profileId, profileName, host, port, username, targetTabId) => {
    useWorkspaceViewStore.getState().showTerminal()
    const existingTab = targetTabId ? get().tabs.find((tab) => tab.id === targetTabId) : null
    const tabId = existingTab?.id ?? `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const newTab: SessionTab = {
      id: tabId,
      profileId,
      profileName,
      sessionId: null,
      status: 'connecting',
      host,
      port,
      username,
      detailAttached: false,
    }

    set((state) => ({
      tabs: existingTab
        ? state.tabs.map((tab) => (tab.id === tabId ? newTab : tab))
        : [...state.tabs, newTab],
      activeTabId: tabId,
    }))

    try {
      const response = await sessionApi.create({
        profile_id: profileId,
        cols: 80,
        rows: 24,
      })
      const current = get().tabs.find((tab) => tab.id === tabId)
      // Cancellation may happen before the create response supplies a session ID.
      if (current !== newTab) {
        if (current?.manualConnect && current.profileId === profileId && !current.sessionId) {
          set((state) => ({
            tabs: state.tabs.map((tab) =>
              tab === current ? { ...tab, sessionId: response.session_id } : tab,
            ),
          }))
          await get().cancelConnection(tabId)
        } else {
          await sessionApi.close(response.session_id)
        }
        return tabId
      }
      get().updateTabStatus(tabId, 'connecting', response.session_id)
    } catch (err) {
      const current = get().tabs.find((tab) => tab.id === tabId)
      if (!current || (current !== newTab && !current.manualConnect)) {
        console.error('Failed to release an obsolete session:', err)
        return tabId
      }
      const apiErr = err as SessionApiError
      if (current.manualConnect && !current.sessionId) return tabId
      if (isHostKeyChangedError(apiErr)) {
        get().setTabHostKeyPrompt(tabId, apiErr.host_fingerprint!, apiErr.known_host_fingerprint)
      } else {
        get().markTabError(
          tabId,
          apiErr?.error?.code || (current.manualConnect ? 'cancel_failed' : 'create_failed'),
          apiErr?.error?.message || (current.manualConnect ? '取消连接失败，请重试' : '无法连接到服务器'),
        )
        console.error('Failed to create session:', err)
      }
    }

    return tabId
  },

  openDraftTab: () => {
    useWorkspaceViewStore.getState().showTerminal()
    const tabId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const newTab: SessionTab = {
      id: tabId,
      profileId: '',
      profileName: '新连接',
      sessionId: null,
      status: 'disconnected',
    }

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
    }))

    return tabId
  },

  cancelConnection: async (tabId) => {
    const tab = get().tabs.find((item) => item.id === tabId)
    if (!tab) return
    set((state) => ({
      tabs: state.tabs.map((item) =>
        item.id === tabId
          ? {
              ...item,
              status: 'disconnected',
              manualConnect: true,
              errorReason: undefined,
              errorMessage: undefined,
              reconnectAttempt: undefined,
              nextRetryAt: undefined,
              hostKeyFingerprint: undefined,
              knownHostKeyFingerprint: undefined,
            }
          : item,
      ),
    }))
    if (tab.sessionId) await sessionApi.close(tab.sessionId)
    const current = get().tabs.find((item) => item.id === tabId)
    if (!current?.manualConnect || current.sessionId !== tab.sessionId) return
    if (current.detailAttached && current.profileId)
      useServerDetailStore.getState().disconnect(current.profileId)
    set((state) => ({
      tabs: state.tabs.map((item) =>
        item === current ? { ...item, sessionId: null, detailAttached: false, latency: undefined } : item,
      ),
    }))
  },

  closeTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (tab?.sessionId) {
      sessionApi.close(tab.sessionId).catch(console.error)
    }
    if (tab?.detailAttached && tab.profileId) {
      useServerDetailStore.getState().disconnect(tab.profileId)
    }

    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== tabId)
      const activeTabId =
        state.activeTabId === tabId ? (tabs.length > 0 ? tabs[tabs.length - 1].id : null) : state.activeTabId
      return { tabs, activeTabId }
    })
  },

  setActiveTab: (tabId) => {
    if (!get().tabs.some((tab) => tab.id === tabId)) return
    useWorkspaceViewStore.getState().showTerminal()
    set({ activeTabId: tabId })
  },

  updateTabCwd: (tabId, cwd) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, cwd } : tab)),
    }))
  },

  updateTabLatency: (tabId, latency) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, latency } : tab)),
    }))
  },

  updateTabStatus: (tabId, status, sessionId) => {
    let shouldAttach = false
    let attachProfileId = ''

    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? (() => {
              const nextTab = {
                ...tab,
                status,
                ...(sessionId ? { sessionId, cwd: undefined, manualConnect: false } : {}),
              }

              if (status === 'connected' && !!tab.profileId && !tab.detailAttached) {
                shouldAttach = true
                attachProfileId = tab.profileId
                nextTab.detailAttached = true
              }

              return nextTab
            })()
          : tab,
      ),
    }))

    if (shouldAttach && attachProfileId) {
      void useServerDetailStore.getState().connect(attachProfileId)
    }
  },

  fetchSessions: async () => {
    try {
      const sessions = await sessionApi.list()
      set((state) => ({
        tabs: state.tabs.map((tab) => {
          const session = sessions.find((item) => item.id === tab.sessionId)
          return session ? { ...tab, status: session.status as SessionTab['status'] } : tab
        }),
      }))
    } catch (err) {
      console.error('Failed to fetch sessions:', err)
    }
  },

  markTabError: (tabId, reason, message) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              status: 'error',
              errorReason: reason,
              errorMessage: message,
              reconnectAttempt: undefined,
              nextRetryAt: undefined,
            }
          : tab,
      ),
    }))
  },

  markTabReconnecting: (tabId, attempt, nextRetryAt) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, status: 'reconnecting', reconnectAttempt: attempt, nextRetryAt } : tab,
      ),
    }))
  },

  clearTabError: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              errorReason: undefined,
              errorMessage: undefined,
              reconnectAttempt: undefined,
              nextRetryAt: undefined,
            }
          : tab,
      ),
    }))
  },

  setTabHostKeyPrompt: (tabId, hostFingerprint, knownHostFingerprint) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              status: 'connecting',
              hostKeyFingerprint: hostFingerprint,
              knownHostKeyFingerprint: knownHostFingerprint,
            }
          : tab,
      ),
    }))
  },

  clearTabHostKeyPrompt: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              hostKeyFingerprint: undefined,
              knownHostKeyFingerprint: undefined,
            }
          : tab,
      ),
    }))
  },
}))
