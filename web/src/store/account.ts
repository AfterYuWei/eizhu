import { create } from 'zustand'
import { accountApi } from '@/api/account'
import type { AccountStatus } from '@/types/account'

interface AccountStore {
  status: AccountStatus | null
  loading: boolean
  error: string | null
  hydrate: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
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
      set({ status: await accountApi.login(email, password), loading: false })
    } catch (cause) {
      set({ error: errorMessage(cause), loading: false })
      throw cause
    }
  },
  register: async (email, password) => {
    set({ loading: true, error: null })
    try {
      set({ status: await accountApi.register(email, password), loading: false })
    } catch (cause) {
      set({ error: errorMessage(cause), loading: false })
      throw cause
    }
  },
  refresh: async () => {
    set({ loading: true, error: null })
    try {
      const user = await accountApi.me()
      set((state) => ({
        status: { loggedIn: true, syncEnabled: state.status?.syncEnabled ?? true, user },
        loading: false,
      }))
    } catch (cause) {
      set({ error: errorMessage(cause), loading: false })
      throw cause
    }
  },
  logout: async () => {
    set({ loading: true, error: null })
    try {
      await accountApi.logout()
      set({ status: { loggedIn: false, syncEnabled: false }, loading: false })
    } catch (cause) {
      // Rust 即使远端吊销失败也会清除本地会话，界面同步进入退出状态。
      set({ status: { loggedIn: false, syncEnabled: false }, error: errorMessage(cause), loading: false })
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

function errorMessage(cause: unknown): string {
  const value = cause as { error?: { code?: string; message?: string } }
  const code = value?.error?.code
  const known: Record<string, string> = {
    ACCOUNT_INVALID_CREDENTIALS: '邮箱或密码不正确',
    ACCOUNT_EMAIL_TAKEN: '该邮箱已被注册',
    ACCOUNT_DISABLED: '账号已被禁用，请联系管理员',
    ACCOUNT_NOT_LOGGED_IN: '登录已失效，请重新登录',
    ACCOUNT_QUOTA_EXCEEDED: '账号云存储空间不足',
  }
  return (code && known[code]) || value?.error?.message || (cause instanceof Error ? cause.message : '账号操作失败')
}
