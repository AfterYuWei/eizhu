import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountWorkspace, validateWorkspace } from './workspace.ts'

test('workspace identities are stable, account-specific and reject forged paths or server identities', () => {
  const a = accountWorkspace(42),
    b = accountWorkspace(43)
  assert.deepEqual(a, accountWorkspace(42))
  assert.notEqual(a.id, b.id)
  assert.deepEqual(validateWorkspace(a), a)
  for (const raw of [
    { ...a, userId: 43 },
    { ...a, server: 'https://other.invalid/' },
    { ...a, id: '../offline' },
  ])
    assert.throws(() => validateWorkspace(raw))
  for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => accountWorkspace(id))
})
