import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { offlineWorkspace } from '@eizhu/contracts'
import type { WorkspaceIdentity } from '@eizhu/contracts'
import { replaceWorkspaceRuntime } from './workspace-runtime.ts'

test('runtime replacement waits for release and restores the previous space with a fresh generation on failure', async () => {
  const actions: string[] = []
  const target: WorkspaceIdentity = {
    id: `account-${'a'.repeat(64)}`,
    server: 'https://eizhu.yuweinfo.com/',
    userId: 42,
  }
  const create = (workspace: WorkspaceIdentity, generation: number) => ({
    workspace,
    context: { runtimeId: randomUUID(), workspaceId: workspace.id, generation },
    start: async () => {
      actions.push(`start:${generation}`)
      if (workspace.id === target.id) throw new Error('synthetic initialization failure')
    },
    close: async () => {
      actions.push(`close:${generation}`)
    },
  })
  const previous = create(offlineWorkspace, 1)
  let active = previous
  await assert.rejects(
    replaceWorkspaceRuntime(previous, target, create, async (host) => {
      active = host
      actions.push(`activate:${host.context.generation}`)
    }),
  )
  assert.deepEqual(actions, ['close:1', 'start:2', 'close:2', 'start:3', 'activate:3'])
  assert.equal(active.workspace.id, 'offline')
  assert.equal(active.context.generation, 3)
})
test('failed release prevents a second database owner from opening', async () => {
  let opened = false
  const previous = {
    workspace: offlineWorkspace,
    context: { runtimeId: randomUUID(), workspaceId: 'offline', generation: 1 },
    start: async () => {},
    close: async () => {
      throw new Error('release failed')
    },
  }
  await assert.rejects(
    replaceWorkspaceRuntime(
      previous,
      offlineWorkspace,
      () => {
        opened = true
        return previous
      },
      async () => {},
    ),
  )
  assert.equal(opened, false)
})
