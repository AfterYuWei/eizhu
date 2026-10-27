import type { RuntimeContext, WorkspaceIdentity } from '@eizhu/contracts'

export interface WorkspaceRuntime {
  context: RuntimeContext
  workspace: WorkspaceIdentity
  start(): Promise<void>
  close(): Promise<void>
}

/** Caller holds the transition lock and completes editor confirmation before entering this barrier. */
export async function replaceWorkspaceRuntime<T extends WorkspaceRuntime>(
  previous: T,
  target: WorkspaceIdentity,
  create: (workspace: WorkspaceIdentity, generation: number) => T,
  activate: (host: T) => Promise<void>,
): Promise<T> {
  await previous.close()
  let candidate: T | undefined
  try {
    candidate = create(target, previous.context.generation + 1)
    await candidate.start()
    await activate(candidate)
    return candidate
  } catch (cause) {
    // Never open another database/runtime until the unsuccessful candidate actually released its resources.
    await candidate?.close()
    const rollback = create(previous.workspace, previous.context.generation + 2)
    try {
      await rollback.start()
      await activate(rollback)
    } catch (recovery) {
      await rollback.close()
      throw new AggregateError([cause, recovery], '账号空间恢复失败，原数据已保留', { cause: recovery })
    }
    throw cause
  }
}
