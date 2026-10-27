import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DesktopError } from '@eizhu/contracts'
import type { WorkspaceIdentity } from '@eizhu/contracts'
import { accountWorkspace } from '@eizhu/core/account/workspace'
import { accountFixtureKey } from '@eizhu/core/database/account-fixture'
import { RuntimeHost } from './runtime-host.ts'
import { replaceWorkspaceRuntime } from './workspace-runtime.ts'

export async function verifyAccountFoundation(runtime: RuntimeHost, assets: string) {
  const storage = await runtime.call<{ passed: boolean; checks: string[]; fixtureRoot: string }>(
    'runtime.verifyAccountFoundation',
  )
  assert.equal(storage.passed, true)
  const key = accountFixtureKey()
  const create = (workspace?: WorkspaceIdentity, generation = 1) =>
    new RuntimeHost(
      storage.fixtureRoot,
      join(assets, '..', '..', 'main'),
      generation,
      () => undefined,
      key,
      workspace,
    )
  let active: RuntimeHost | undefined
  try {
    active = create()
    await active.start()
    assert.equal(active.workspace.id, accountWorkspace(43).id)
    assert.equal((await active.call<{ userId: number }>('workspace.status')).userId, 43)
    assert.equal((await active.call<{ schema: number }>('runtime.health')).schema, 3)
    assert.deepEqual(await active.call('group.list'), [])
    const previousGeneration = active.context.generation
    await assert.rejects(
      replaceWorkspaceRuntime(active, accountWorkspace(44), create, async (host) => {
        active = host
        await host.call('runtime.health')
      }),
      (cause: unknown) => cause instanceof DesktopError && cause.error.code === 'RUNTIME_INIT_FAILED',
    )
    assert.equal(active.workspace.id, accountWorkspace(43).id)
    assert.equal(active.context.generation, previousGeneration + 2)
    assert.equal((await active.call<{ userId: number }>('workspace.status')).userId, 43)
    await active.close()
    active = undefined

    active = create(accountWorkspace(42), 4)
    await active.start()
    const groups = await active.call<Array<{ name: string }>>('group.list')
    assert.deepEqual(
      groups.map((group) => group.name),
      ['账号 A 独立分组'],
    )
    assert.equal((await active.call<{ userId: number }>('workspace.status')).userId, 42)
    return {
      passed: true,
      checks: storage.checks,
      runtime: {
        restoredAccountIdentity: true,
        explicitAccountIsolation: true,
        failedTargetRollback: true,
        nativeProcessTree: true,
      },
    }
  } finally {
    await active?.close()
    key.fill(0)
  }
}
