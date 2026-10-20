import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '@eizhu/contracts'
import { LocalStore } from './local-store.ts'

/** Global UI metadata and the separately encrypted offline business store. Only used by database Workers. */
export class FoundationStore {
  readonly local: LocalStore
  private global: Database.Database
  private workspace!: Database.Database
  constructor(root: string, key: Uint8Array) {
    mkdirSync(join(root, 'workspaces', 'offline'), { recursive: true, mode: 0o700 })
    this.global = this.open(
      join(root, 'global.sqlite'),
      `
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE accounts (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
    `,
    )
    try {
      this.workspace = this.open(
        join(root, 'workspaces', 'offline', 'workspace.sqlite'),
        `
        CREATE TABLE workspace_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO workspace_metadata VALUES ('id', 'offline');
        CREATE TABLE revisions (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);
        INSERT INTO revisions VALUES (1, 0);
      `,
      )
      this.local = new LocalStore(this.workspace, key)
    } catch (cause) {
      this.workspace?.close()
      this.global.close()
      throw cause
    }
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
      else if (version !== 1 && !(path.endsWith('workspace.sqlite') && version === 2))
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
    this.local.close()
    this.workspace.close()
    this.global.close()
  }
}
