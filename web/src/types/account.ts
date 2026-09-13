export interface AccountUser {
  email: string
  storageUsed: number
  storageQuota: number
}

export interface AccountStatus {
  loggedIn: boolean
  user?: AccountUser
  syncEnabled: boolean
}
