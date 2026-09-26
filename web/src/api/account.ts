import { invokeCommand } from './tauri'
import type { AccountStatus, AccountUser } from '@/types/account'

export const accountApi = {
  status: () => invokeCommand<AccountStatus>('account_status'),
  login: (email: string, password: string) =>
    invokeCommand<AccountStatus>('account_login', { email, password }),
  register: (email: string, password: string) =>
    invokeCommand<AccountStatus>('account_register', { email, password }),
  logout: () => invokeCommand<void>('account_logout'),
  me: () => invokeCommand<AccountUser>('account_me'),
  setSyncEnabled: (enabled: boolean) =>
    invokeCommand<AccountStatus>('account_set_sync_enabled', { enabled }),
}
