import { z } from 'zod'
import type Database from 'better-sqlite3'
import {
  accountStatusSchema,
  accountUserSchema,
  fail,
  offlineWorkspace,
  workspaceIdentitySchema,
} from '@eizhu/contracts'
import type { AccountStatus, WorkspaceIdentity } from '@eizhu/contracts'
import { LocalCipher } from '../local/crypto.ts'
import { validateWorkspace } from './workspace.ts'

const tokens = z.strictObject({
  accessToken: z.string().min(1).max(32768),
  refreshToken: z.string().min(1).max(32768),
  expiresAt: z.int().positive(),
})
const cachedSyncKey = z.strictObject({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.int().nonnegative(),
})
const metadataSchema = z.strictObject({
  workspace: workspaceIdentitySchema,
  user: accountUserSchema,
  syncEnabled: z.boolean(),
})
export const accountSessionSchema = z.strictObject({
  user: accountUserSchema,
  syncEnabled: z.boolean(),
  tokens: tokens.nullable(),
  cachedSyncKey: cachedSyncKey.optional(),
})
export type AccountSession = z.infer<typeof accountSessionSchema>

/** Only the database Worker owns this repository. Secret records never cross public IPC. */
export class AccountRepository {
  private db: Database.Database
  private cipher: LocalCipher
  constructor(db: Database.Database, key: Uint8Array) {
    this.db = db
    this.cipher = new LocalCipher(key, 'global')
    try {
      const row = db.prepare("SELECT data FROM global_state WHERE key='key-check'").get() as
        { data: Buffer } | undefined
      if (!row || this.cipher.open(row.data, 'key-check') !== 'eizhu-global-v2')
        fail('KEY_INVALID', '全局数据密钥校验失败，原数据已保留')
    } catch (cause) {
      this.cipher.close()
      throw cause
    }
  }
  private metadata(identity: WorkspaceIdentity) {
    validateWorkspace(identity)
    const row = this.db.prepare('SELECT metadata FROM accounts WHERE id=?').get(identity.id) as
      { metadata: string } | undefined
    if (!row) return fail('ACCOUNT_NOT_FOUND', '账号空间元数据不存在')
    const value = metadataSchema.parse(JSON.parse(row.metadata))
    if (value.workspace.id !== identity.id || value.user.id !== identity.userId)
      fail('WORKSPACE_INVALID', '账号空间元数据不匹配')
    validateWorkspace(value.workspace)
    return value
  }
  save(identity: WorkspaceIdentity, raw: AccountSession): void {
    validateWorkspace(identity)
    const session = accountSessionSchema.parse(raw)
    if (identity.id === 'offline' || session.user.id !== identity.userId)
      fail('WORKSPACE_INVALID', '账号会话不属于当前空间')
    const metadata = JSON.stringify({
      workspace: identity,
      user: session.user,
      syncEnabled: session.syncEnabled,
    })
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO accounts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata')
        .run(identity.id, metadata)
      this.db
        .prepare(
          'INSERT INTO account_sessions VALUES (?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data',
        )
        .run(identity.id, this.cipher.seal(session, `account-session:${identity.id}`))
    })()
  }
  session(identity: WorkspaceIdentity): AccountSession | null {
    if (identity.id === 'offline') return null
    this.metadata(identity)
    const row = this.db.prepare('SELECT data FROM account_sessions WHERE workspace_id=?').get(identity.id) as
      { data: Buffer } | undefined
    if (!row) return null
    const session = accountSessionSchema.parse(this.cipher.open(row.data, `account-session:${identity.id}`))
    if (session.user.id !== identity.userId) fail('WORKSPACE_INVALID', '账号会话身份不匹配')
    return session
  }
  status(identity: WorkspaceIdentity): AccountStatus {
    if (identity.id === 'offline') return { loggedIn: false, sessionState: 'anonymous', syncEnabled: false }
    const metadata = this.metadata(identity),
      session = this.session(identity)
    return accountStatusSchema.parse({
      loggedIn: true,
      user: session?.user ?? metadata.user,
      syncEnabled: session?.syncEnabled ?? metadata.syncEnabled,
      // An expired access token remains refreshable. Only an invalidated/removed session needs login.
      sessionState: session?.tokens ? 'authenticated' : 'reauth_required',
    })
  }
  active(): WorkspaceIdentity {
    const row = this.db.prepare("SELECT data FROM global_state WHERE key='active-workspace'").get() as
      { data: Buffer } | undefined
    const identity = row
      ? validateWorkspace(this.cipher.open(row.data, 'active-workspace'))
      : offlineWorkspace
    if (identity.id !== 'offline') this.metadata(identity)
    return identity
  }
  activate(identity: WorkspaceIdentity): void {
    validateWorkspace(identity)
    if (identity.id !== 'offline') this.metadata(identity)
    this.db.transaction(() => this.writeActive(identity))()
  }
  private writeActive(identity: WorkspaceIdentity): void {
    this.db
      .prepare(
        "INSERT INTO global_state VALUES ('active-workspace',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
      )
      .run(this.cipher.seal(identity, 'active-workspace'))
  }
  forget(identity: WorkspaceIdentity): void {
    if (identity.id === 'offline') return
    this.metadata(identity)
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM account_sessions WHERE workspace_id=?').run(identity.id)
      if (this.active().id === identity.id) this.writeActive(offlineWorkspace)
    })()
  }
  close(): void {
    this.cipher.close()
  }
}
