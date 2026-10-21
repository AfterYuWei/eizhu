import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DocumentGrants, saveAtomically } from './documents.ts'

test('file grants reject arbitrary paths, wrong windows, contexts, kinds and released references', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-grants-'))
  try {
    const path = join(root, '测试备份.eizhubackup')
    await writeFile(path, 'synthetic')
    const grants = new DocumentGrants(),
      context = { runtimeId: randomUUID(), workspaceId: 'offline', generation: 1 }
    const grant = await grants.add(1, context, path, 'backup')
    assert.equal(grants.get(1, context, grant.reference, 'backup').path, path)
    assert.throws(() => grants.get(1, context, path))
    assert.throws(() => grants.get(2, context, grant.reference))
    assert.throws(() => grants.get(1, { ...context, generation: 2 }, grant.reference))
    assert.throws(() => grants.get(1, context, grant.reference, 'text'))
    grants.release(1, context, grant.reference)
    assert.throws(() => grants.get(1, context, grant.reference))
    const next = await grants.add(1, context, path, 'backup')
    grants.revoke(1)
    assert.throws(() => grants.get(1, context, next.reference))
    await saveAtomically(path, 'replacement')
    assert.equal(await readFile(path, 'utf8'), 'replacement')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
