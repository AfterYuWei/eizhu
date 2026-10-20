import { bridge } from '@/lib/bridge'

export const accountApi = {
  status: () => bridge().account.status(),
  login: (email: string, password: string) => bridge().account.login({ email, password }),
  register: (email: string, password: string) => bridge().account.register({ email, password }),
  sendVerificationEmail: () => bridge().account.sendVerificationEmail(),
  verifyEmail: (code: string) => bridge().account.verifyEmail({ code }),
  requestPasswordReset: (email: string) => bridge().account.requestPasswordReset({ email }),
  resetPassword: (email: string, code: string, newPassword: string) =>
    bridge().account.resetPassword({ email, code, newPassword }),
  logout: () => bridge().account.logout(),
  me: () => bridge().account.me(),
  setSyncEnabled: (enabled: boolean) => bridge().account.setSyncEnabled({ enabled }),
}
