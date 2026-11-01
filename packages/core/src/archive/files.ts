import { randomUUID } from 'node:crypto'
import { lstat, open, realpath, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from '@eizhu/contracts'

export async function backupDirectory(path: string): Promise<string> {
  const resolved = await realpath(path)
  if (!(await lstat(resolved)).isDirectory()) fail('BACKUP_DIRECTORY_INVALID', '备份目录不可用，请重新选择')
  return resolved
}

/** Publish a complete, ordinary backup file; never overwrite or clean up an earlier backup. */
export async function saveBackup(
  directory: string,
  bytes: Uint8Array,
): Promise<{ path: string; name: string }> {
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink())
    fail('BACKUP_DIRECTORY_INVALID', '备份目录已变化，请重新选择')
  const name = `eizhu-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.eizhubackup`
  const path = join(directory, name),
    temporary = join(directory, `.${name}.tmp`)
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(bytes)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, path)
    return { path, name }
  } finally {
    await rm(temporary, { force: true })
  }
}
