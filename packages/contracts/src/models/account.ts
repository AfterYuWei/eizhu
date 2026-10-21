export interface AccountUser {
  id?: number
  emailVerified?: boolean
  verificationRequired?: boolean
  email: string
  storageUsed: number
  storageQuota: number
}

export interface AccountStatus {
  loggedIn: boolean
  user?: AccountUser
  syncEnabled: boolean
}
