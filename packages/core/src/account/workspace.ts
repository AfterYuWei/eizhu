import { createHash } from 'node:crypto'
import { ACCOUNT_SERVER, workspaceIdentitySchema, fail } from '@eizhu/contracts'
import type { WorkspaceIdentity } from '@eizhu/contracts'

export function accountWorkspace(userId: number): Extract<WorkspaceIdentity, { server: string }> {
  if (!Number.isSafeInteger(userId) || userId <= 0) fail('ACCOUNT_ID_INVALID', '账号标识无效')
  const digest = createHash('sha256')
    .update(JSON.stringify([ACCOUNT_SERVER, userId]))
    .digest('hex')
  return { id: `account-${digest}`, server: ACCOUNT_SERVER, userId }
}
export function validateWorkspace(value: unknown): WorkspaceIdentity {
  const identity = workspaceIdentitySchema.parse(value)
  if (identity.id !== 'offline' && identity.id !== accountWorkspace(identity.userId).id)
    fail('WORKSPACE_INVALID', '账号空间与服务端身份不匹配')
  return identity
}
