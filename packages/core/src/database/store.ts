import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '@eizhu/contracts'
import type { WorkspaceIdentity } from '@eizhu/contracts'
import { LocalStore } from './local-store.ts'
import { LocalCipher } from '../local/crypto.ts'
import { AccountRepository } from '../account/repository.ts'
import { validateWorkspace } from '../account/workspace.ts'
import { preserveBeforeMigration } from './migrations.ts'
import { SyncRepository } from '../sync/repository.ts'
import { emptyPayload, kinds, payloadSchema } from '../local/model.ts'
import type { Payload, Kind } from '../local/model.ts'

/** Global metadata and one isolated business workspace. Only used by database Workers. */
export class FoundationStore {
  readonly local!: LocalStore
  readonly accounts!: AccountRepository
  readonly sync!: SyncRepository
  readonly identity: WorkspaceIdentity
  private global: Database.Database
  private workspace!: Database.Database
  private deviceKey: Buffer
  private root: string
  constructor(root: string, key: Uint8Array, requested?: WorkspaceIdentity) {
    this.root = root
    this.deviceKey = Buffer.from(key)
    mkdirSync(root, { recursive: true, mode: 0o700 })
    const globalPath = join(root, 'global.sqlite'),
      globalExisted = existsSync(globalPath)
    this.global = this.open(
      globalPath,
      `
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE accounts (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
    `,
    )
    try {
      if (this.global.pragma('user_version', { simple: true }) === 1) {
        // Validate existing offline ciphertext before binding a new global key marker.
        const offline = join(root, 'workspaces', 'offline', 'workspace.sqlite')
        if (existsSync(offline)) {
          const previous = new Database(offline, { readonly: true, fileMustExist: true })
          const cipher = new LocalCipher(key, 'offline')
          try {
            const version = Number(previous.pragma('user_version', { simple: true }))
            if (![1, 2, 3].includes(version)) fail('SCHEMA_UNSUPPORTED', '业务数据版本不受支持，原数据已保留')
            if (version >= 2) {
              const marker = previous.prepare('SELECT data FROM key_check WHERE id=1').get() as
                { data: Buffer } | undefined
              if (!marker || cipher.open(marker.data, 'key-check') !== 'eizhu-local-v2')
                fail('KEY_INVALID', '数据密钥校验失败，原数据已保留')
            }
          } finally {
            cipher.close()
            previous.close()
          }
        }
        if (globalExisted) preserveBeforeMigration(this.global, root, 'global', 1, 2)
        const cipher = new LocalCipher(key, 'global')
        try {
          this.global.transaction(() => {
            this.global.exec(`
              CREATE TABLE account_sessions (workspace_id TEXT PRIMARY KEY REFERENCES accounts(id), data BLOB NOT NULL);
              CREATE TABLE global_state (key TEXT PRIMARY KEY, data BLOB NOT NULL);
            `)
            this.global
              .prepare("INSERT INTO global_state VALUES ('key-check',?)")
              .run(cipher.seal('eizhu-global-v2', 'key-check'))
            this.global.pragma('user_version = 2')
          })()
        } finally {
          cipher.close()
        }
      }
      this.accounts = new AccountRepository(this.global, key)
      this.identity = validateWorkspace(requested ?? this.accounts.active())
      if (this.identity.id !== 'offline') this.accounts.status(this.identity)
      const workspacePath = join(root, 'workspaces', this.identity.id, 'workspace.sqlite')
      const workspaceExisted = existsSync(workspacePath)
      mkdirSync(join(root, 'workspaces', this.identity.id), { recursive: true, mode: 0o700 })
      this.workspace = this.open(
        workspacePath,
        `
        CREATE TABLE workspace_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE revisions (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);
        INSERT INTO revisions VALUES (1, 0);
      `,
      )
      const metadata = this.workspace.prepare("SELECT value FROM workspace_metadata WHERE key='id'").get() as
        { value: string } | undefined
      if (metadata && metadata.value !== this.identity.id)
        fail('WORKSPACE_INVALID', '业务库不属于当前空间，原数据已保留')
      this.local = new LocalStore(this.workspace, key, this.identity.id, () => {
        if (workspaceExisted) preserveBeforeMigration(this.workspace, root, this.identity.id, 2, 3)
      })
      this.sync = new SyncRepository(this.workspace, this.local, key, this.identity.id, () => this.offlineSnapshot())
      if (!metadata)
        this.workspace.prepare("INSERT INTO workspace_metadata VALUES ('id',?)").run(this.identity.id)
    } catch (cause) {
      this.sync?.close()
      this.deviceKey.fill(0)
      this.accounts?.close()
      this.local?.close()
      this.workspace?.close()
      this.global.close()
      throw cause
    }
  }
  private offlineSnapshot(): { payload: Payload; revision: number } {
    if (this.identity.id === 'offline') return { payload: this.local.snapshot(), revision: this.local.archiveRevision() }
    const path = join(this.root, 'workspaces', 'offline', 'workspace.sqlite')
    if (!existsSync(path)) return { payload: emptyPayload(), revision: 0 }
    const db = new Database(path, { readonly: true, fileMustExist: true }), cipher = new LocalCipher(this.deviceKey, 'offline')
    try {
      const version = Number(db.pragma('user_version', { simple: true }))
      if (![2, 3].includes(version)) fail('SCHEMA_UNSUPPORTED', '离线空间版本不受支持，原数据已保留')
      const marker = db.prepare('SELECT data FROM key_check WHERE id=1').get() as {data:Buffer}|undefined
      if (!marker || cipher.open(marker.data, 'key-check') !== 'eizhu-local-v2') fail('KEY_INVALID', '离线空间密钥无效')
      return db.transaction(() => {
        const payload = emptyPayload()
        for (const kind of kinds) {
          const rows = db.prepare('SELECT id,data FROM entities WHERE kind=? ORDER BY id').all(kind) as Array<{id:string;data:Buffer}>
          for (const row of rows) (payload[kind] as Payload[Kind][number][]).push(cipher.open(row.data, `entity:${kind}:${row.id}`))
        }
        return { payload: payloadSchema.parse(payload), revision: (db.prepare('SELECT revision FROM revisions WHERE id=1').get() as {revision:number}).revision }
      })()
    } finally { cipher.close(); db.close() }
  }
  private open(path: string, schema: string): Database.Database {
    const db = new Database(path)
    try {
      db.pragma('journal_mode = WAL')
      db.pragma('foreign_keys = ON')
      db.pragma('busy_timeout = 5000')
      const version = db.pragma('user_version', { simple: true })
      if (version === 0)
        db.transaction(() => {
          db.exec(schema)
          db.pragma('user_version = 1')
        })()
      else if (![1, 2, ...(path.endsWith('workspace.sqlite') ? [3] : [])].includes(Number(version)))
        fail('SCHEMA_UNSUPPORTED', '数据版本高于当前应用支持范围，原数据已保留')
      return db
    } catch (cause) {
      db.close()
      throw cause
    }
  }
  settings(): Record<string, string> {
    return Object.fromEntries(
      (
        this.global.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
      ).map((row) => [row.key, row.value]),
    )
  }
  writeSetting(key: string, value: string | null): void {
    this.global.transaction(() => {
      if (value === null) this.global.prepare('DELETE FROM settings WHERE key = ?').run(key)
      else
        this.global
          .prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
          .run(key, value)
    })()
  }
  close(): void {
    this.sync.close()
    this.deviceKey.fill(0)
    this.local.close()
    this.accounts.close()
    this.workspace.close()
    this.global.close()
  }
}
