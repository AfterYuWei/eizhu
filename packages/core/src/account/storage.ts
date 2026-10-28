import { z } from 'zod'
import { accountUserSchema, workspaceIdentitySchema } from '@eizhu/contracts'
import type { AccountStatus, AccountUser, WorkspaceIdentity } from '@eizhu/contracts'
import type { WorkerClient } from '../workers/client.ts'
import { accountSessionSchema } from './repository.ts'
import type { AccountSession } from './repository.ts'

export const accountStorage = {
  'account.storage.acceptLogin': z.strictObject({
    workspace: workspaceIdentitySchema,
    user: accountUserSchema,
    tokens: accountSessionSchema.shape.tokens.unwrap(),
    secrets: accountSessionSchema.pick({ cachedSyncKey: true, masterKeys: true }).optional(),
  }),
  'account.storage.session': workspaceIdentitySchema,
  'account.storage.save': z.strictObject({
    workspace: workspaceIdentitySchema,
    session: accountSessionSchema,
  }),
  'account.storage.update': z.strictObject({
    workspace: workspaceIdentitySchema,
    expectedRefreshToken: z.string().min(1).max(32768),
    user: accountUserSchema.optional(),
    tokens: accountSessionSchema.shape.tokens.optional(),
  }),
  'account.storage.commit': z.strictObject({
    target: workspaceIdentitySchema,
    logoutSource: workspaceIdentitySchema.optional(),
  }),
} as const
export interface AccountStorage {
  status(): Promise<AccountStatus>
  session(workspace: WorkspaceIdentity): Promise<AccountSession | null>
  save(workspace: WorkspaceIdentity, session: AccountSession): Promise<void>
  acceptLogin(
    workspace: WorkspaceIdentity,
    user: AccountSession['user'],
    tokens: NonNullable<AccountSession['tokens']>,
    secrets?: Pick<AccountSession, 'cachedSyncKey' | 'masterKeys'>,
  ): Promise<AccountSession>
  update(
    workspace: WorkspaceIdentity,
    expectedRefreshToken: string,
    patch: { user?: AccountUser; tokens?: AccountSession['tokens'] },
  ): Promise<AccountSession>
}
export function workerAccountStorage(worker: WorkerClient): AccountStorage {
  return {
    status: () => worker.call('account.storage.status'),
    session: (workspace) => worker.call('account.storage.session', workspace),
    save: (workspace, session) => worker.call('account.storage.save', { workspace, session }),
    acceptLogin: (workspace, user, tokens, secrets) =>
      worker.call('account.storage.acceptLogin', { workspace, user, tokens, secrets }),
    update: (workspace, expectedRefreshToken, patch) =>
      worker.call('account.storage.update', { workspace, expectedRefreshToken, ...patch }),
  }
}
