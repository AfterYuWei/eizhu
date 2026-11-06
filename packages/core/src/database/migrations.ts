import type Database from 'better-sqlite3'
import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fail } from '@eizhu/contracts'

/** VACUUM INTO includes committed WAL data. Backups are private, immutable rollback copies. */
export function preserveBeforeMigration(
  db: Database.Database,
  root: string,
  name: string,
  from: number,
  to: number,
): void {
  if (!/^(global|offline|account-[a-f0-9]{64})$/.test(name)) fail('WORKSPACE_INVALID', '迁移空间标识无效')
  const directory = join(root, 'schema-backups')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (lstatSync(directory).isSymbolicLink()) fail('MIGRATION_BACKUP_FAILED', '迁移副本目录不能是符号链接')
  const base = `${name}-v${from}-before-v${to}`
  let path = join(directory, `${base}.sqlite`)
  if (existsSync(path)) {
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
      fail('MIGRATION_BACKUP_FAILED', '已有迁移副本异常，原数据已保留')
    // A retried migration may follow legitimate edits in the old schema. Preserve a fresh copy as well.
    path = join(directory, `${base}-${randomUUID()}.sqlite`)
  }
  db.prepare('VACUUM INTO ?').run(path)
  if (process.platform !== 'win32') chmodSync(path, 0o600)
}
