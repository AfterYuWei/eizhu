import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { acceptBootstrapUpdate, acceptWorkspaceTransition } from '../index.ts'
import type { Bootstrap } from '../index.ts'

function bootstrap(generation: number, workspaceId = 'offline', userId = 0): Bootstrap {
  return {
    context: { runtimeId: randomUUID(), workspaceId, generation },
    workspace: { id: workspaceId, generation, userId },
    window: 'main',
    version: 'test',
    settings: {},
    platform: {
      platform: 'macos',
      runtime: 'desktop',
      windowControls: true,
      appUpdates: false,
      dragOut: true,
      nativeFilePaths: true,
      documentPicker: true,
      secureKeyStore: true,
      maxConcurrentTransfers: 5,
    },
  }
}
test('only a matching account transition can accept a changed workspace response', () => {
  const current = bootstrap(1),
    next = bootstrap(2, `account-${'a'.repeat(64)}`, 42)
  const transition = {
    fromContext: current.context,
    bootstrap: next,
    account: {
      loggedIn: true,
      sessionState: 'authenticated',
      syncEnabled: true,
      user: {
        id: 42,
        email: 'user@example.invalid',
        emailVerified: true,
        verificationRequired: true,
        storageUsed: 0,
        storageQuota: 1024,
      },
    },
  }
  assert.deepEqual(
    acceptWorkspaceTransition('account.login', current.context, current.context, transition),
    transition,
  )
  assert.deepEqual(
    acceptWorkspaceTransition('account.login', current.context, next.context, transition),
    transition,
  )
  for (const [operation, sent, active, result] of [
    ['profile.list', current.context, current.context, transition],
    ['account.logout', current.context, current.context, transition],
    ['account.login', bootstrap(1).context, current.context, transition],
    ['account.login', current.context, bootstrap(3).context, transition],
    [
      'account.login',
      current.context,
      current.context,
      { ...transition, bootstrap: { ...next, workspace: { ...next.workspace, userId: 43 } } },
    ],
  ] as const)
    assert.throws(() => acceptWorkspaceTransition(operation, sent, active, result))
})
test('bootstrap updates reject delayed generations and inconsistent workspace context', () => {
  const previous = bootstrap(1),
    current = bootstrap(2)
  assert.deepEqual(acceptBootstrapUpdate(previous, current), current)
  assert.deepEqual(acceptBootstrapUpdate(current, current), current)
  assert.throws(() => acceptBootstrapUpdate(current, previous))
  assert.throws(() => acceptBootstrapUpdate(current, bootstrap(2)))
  assert.throws(() =>
    acceptBootstrapUpdate(previous, { ...current, workspace: { ...current.workspace, generation: 3 } }),
  )
})
