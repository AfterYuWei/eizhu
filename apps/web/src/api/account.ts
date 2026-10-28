import { bridge } from '@/lib/bridge'

export const accountApi = {
  requestRegistrationCode: (email: string) => bridge().account.requestRegistrationCode({ email }),
  verifyRegistrationCode: (email: string, challengeId: string, code: string) =>
    bridge().account.verifyRegistrationCode({ email, challengeId, code }),
  recoveryAvailable: (email: string) => bridge().account.recoveryAvailable({ email }),
  changePassword: (password: string, newPassword: string) =>
    bridge().account.changePassword({ password, newPassword }),
  status: () => bridge().account.status(),
  login: (email: string, password: string) => bridge().account.login({ email, password }),
  register: (email: string, password: string, ticket: string) =>
    bridge().account.register({ email, password, ticket }),
  requestPasswordReset: (email: string) => bridge().account.requestPasswordReset({ email }),
  resetPassword: (email: string, code: string, newPassword: string) =>
    bridge().account.resetPassword({ email, code, newPassword }),
  logout: () => bridge().account.logout(),
  me: () => bridge().account.me(),
  setSyncEnabled: (enabled: boolean) => bridge().account.setSyncEnabled({ enabled }),
}
