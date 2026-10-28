import { refreshWorkspace } from '@/lib/workspace'
import { create } from 'zustand'
import { accountApi } from '@/api/account'
import type { AccountStatus } from '@/types/account'

interface AccountStore {
  status: AccountStatus | null
  loading: boolean
  error: string | null
  hydrate: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, ticket: string) => Promise<void>
  refresh: () => Promise<void>
  logout: () => Promise<void>
  setSyncEnabled: (enabled: boolean) => Promise<void>
}

export const useAccountStore = create<AccountStore>((set) => ({
  status: null,
  loading: false,
  error: null,
  hydrate: async () => {
    set({ loading: true, error: null })
    try {
      set({ status: await accountApi.status(), loading: false })
    } catch (cause) {
      set({ error: errorMessage(cause), loading: false })
    }
  },
  login: async (email, password) => {
    set({ loading: true, error: null })
    try {
      const status = await accountApi.login(email, password)
      await refreshWorkspace()
      set({ status, loading: false })
    } catch (cause) {
      if (isCancelled(cause)) {
        set({ loading: false, error: null })
        throw cause
      }
      set({ error: errorMessage(cause), loading: false })
      throw cause
    }
  },
  register: async (email, password, ticket) => {
    set({ loading: true, error: null })
    try {
      const status = await accountApi.register(email, password, ticket)
      await refreshWorkspace()
      set({ status, loading: false })
    } catch (cause) {
      if (isCancelled(cause)) {
        set({ loading: false, error: null })
        throw cause
      }
      set({ error: errorMessage(cause), loading: false })
      throw cause
    }
  },
  refresh: async () => {
    set({ loading: true, error: null })
    try {
      const user = await accountApi.me()
      set((state) => ({
        status: {
          loggedIn: true,
          sessionState: 'authenticated',
          syncEnabled: state.status?.syncEnabled ?? false,
          user,
        },
        loading: false,
      }))
    } catch (cause) {
      const status = await accountApi.status().catch(() => null)
      set((state) => ({ status: status ?? state.status, error: errorMessage(cause), loading: false }))
      throw cause
    }
  },
  logout: async () => {
    set({ loading: true, error: null })
    try {
      await accountApi.logout()
      await refreshWorkspace()
      set({ status: { loggedIn: false, sessionState: 'anonymous', syncEnabled: false }, loading: false })
    } catch (cause) {
      if (isCancelled(cause)) {
        set({ loading: false, error: null })
        return
      }
      // 空间切换或退出失败时，重新读取真实状态；读取也失败则保留原展示，不能伪造退出成功。
      await refreshWorkspace().catch(() => {})
      const status = await accountApi.status().catch(() => null)
      set((state) => ({ status: status ?? state.status, error: errorMessage(cause), loading: false }))
    }
  },
  setSyncEnabled: async (enabled) => {
    set({ loading: true, error: null })
    try {
      set({ status: await accountApi.setSyncEnabled(enabled), loading: false })
    } catch (cause) {
      set({ error: errorMessage(cause), loading: false })
      throw cause
    }
  },
}))

function isCancelled(cause: unknown): boolean {
  const value = cause as { code?: string; error?: { code?: string } }
  return (value?.code ?? value?.error?.code) === 'CANCELLED'
}

function errorMessage(cause: unknown): string {
  const value = cause as { code?: string; message?: string; error?: { code?: string; message?: string } }
  const code = value?.code ?? value?.error?.code
  const known: Record<string, string> = {
    ACCOUNT_INVALID_CREDENTIALS: '邮箱或主密码不正确',
    ACCOUNT_EMAIL_TAKEN: '该邮箱已被注册',
    ACCOUNT_DISABLED: '账号已被禁用，请联系管理员',
    ACCOUNT_NOT_LOGGED_IN: '登录已失效，请重新登录',
    ACCOUNT_QUOTA_EXCEEDED: '账号云存储空间不足',
  }
  return (code && known[code]) || value?.error?.message || value?.message || '账号操作失败'
}
