import { invokeCommand } from './tauri'
import type { AccountStatus, AccountUser } from '@/types/account'

export const accountApi = {
  status: () => invokeCommand<AccountStatus>('account_status'),
  login: (email: string, password: string) =>
    invokeCommand<AccountStatus>('account_login', { email, password }),
  register: (email: string, password: string) =>
    invokeCommand<AccountStatus>('account_register', { email, password }),
  sendVerificationEmail: () => invokeCommand<void>('account_send_verification_email'),
  verifyEmail: (code: string) => invokeCommand<void>('account_verify_email', { code }),
  requestPasswordReset: (email: string) => invokeCommand<void>('account_request_password_reset', { email }),
  resetPassword: (email: string, code: string, newPassword: string) =>
    invokeCommand<void>('account_reset_password', { email, code, newPassword }),
  logout: () => invokeCommand<void>('account_logout'),
  me: () => invokeCommand<AccountUser>('account_me'),
  setSyncEnabled: (enabled: boolean) =>
    invokeCommand<AccountStatus>('account_set_sync_enabled', { enabled }),
}
