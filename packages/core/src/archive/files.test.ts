import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, symlink, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { backupDirectory, saveBackup } from './files.ts'

test('automatic backups are complete private files with unique names; earlier files remain byte-for-byte intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-backup-file-'))
  try {
    assert.equal(
      await backupDirectory(root),
      await realpath(root),
    )
    const first = await saveBackup(root, Buffer.from('encrypted first backup'))
    const second = await saveBackup(root, Buffer.from('encrypted second backup'))
    assert.notEqual(first.path, second.path)
    assert.match(first.name, /^eizhu-.*\.eizhubackup$/)
    assert.equal(await readFile(first.path, 'utf8'), 'encrypted first backup')
    assert.equal(await readFile(second.path, 'utf8'), 'encrypted second backup')
    assert.equal((await readdir(root)).length, 2)
    if (process.platform !== 'win32') assert.equal((await stat(first.path)).mode & 0o777, 0o600)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a missing or replaced backup directory fails without creating a partial backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-backup-directory-'))
  try {
    await assert.rejects(saveBackup(join(root, 'missing'), Buffer.from('backup')))
    if (process.platform !== 'win32') {
      const link = join(root, 'changed-directory')
      await symlink(root, link, 'dir')
      await assert.rejects(saveBackup(link, Buffer.from('backup')), /目录已变化/)
      assert.deepEqual(await readdir(root), ['changed-directory'])
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
