import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  foundation,
  sameContext,
  requestSchema,
  reservedOperations,
  failureOf,
  DesktopError,
} from '../index.ts'
const context = { runtimeId: randomUUID(), workspaceId: 'offline', generation: 1 }
test('scope rejects stale instances, workspaces and generations independently', () => {
  assert.equal(sameContext(context, { ...context }), true)
  assert.equal(sameContext(context, { ...context, generation: 2 }), false)
  assert.equal(sameContext(context, { ...context, workspaceId: 'account' }), false)
  assert.equal(sameContext(context, { ...context, runtimeId: randomUUID() }), false)
})
test('only exact request envelopes, bounded settings and http(s) external links are accepted', () => {
  assert.equal(
    requestSchema.safeParse({ id: randomUUID(), context, operation: 'workspace.status', input: undefined })
      .success,
    true,
  )
  assert.equal(
    requestSchema.safeParse({ id: randomUUID(), context, operation: 'workspace.status', sql: 'SELECT 1' })
      .success,
    false,
  )
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'eizhu://app/index.html'])
    assert.equal(foundation['system.openExternal'].input.safeParse({ url }).success, false)
  assert.equal(
    foundation['system.openExternal'].input.safeParse({ url: 'https://example.invalid' }).success,
    true,
  )
  assert.equal(foundation['settings.write'].input.safeParse({ key: 'credential', value: 'x' }).success, false)
  assert.equal(
    foundation['settings.write'].input.safeParse({ key: 'eizhu-settings', value: 'x'.repeat(65537) }).success,
    false,
  )
})
test('errors never serialize raw third-party details and preserve intentional structured context', () => {
  assert.deepEqual(failureOf(new Error('password=synthetic-secret')), {
    code: 'INTERNAL',
    message: '操作失败，请查看诊断日志',
  })
  assert.equal(
    failureOf(new DesktopError({ code: 'WORKSPACE_CHANGED', message: 'changed' })).code,
    'WORKSPACE_CHANGED',
  )
  assert.equal(new Set(reservedOperations).size, reservedOperations.length)
  for (const name of reservedOperations) assert.match(name, /^[a-z][a-zA-Z]+\.[a-z][a-zA-Z]+$/)
})
