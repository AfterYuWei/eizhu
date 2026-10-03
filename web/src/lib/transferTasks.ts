import type { TransferTask } from '@/types/sftp'

/** Rust owns execution generations and confirmed offsets. Ignore delayed events. */
export function mergeTransferTasks(current: TransferTask[], incoming: TransferTask[]): TransferTask[] {
  const tasks = new Map(current.map((task) => [task.id, task]))
  for (const task of incoming) {
    const previous = tasks.get(task.id)
    if (previous) {
      const oldGeneration = previous.execution_generation ?? 0
      const nextGeneration = task.execution_generation ?? 0
      if (nextGeneration < oldGeneration) continue
      if (nextGeneration === oldGeneration) {
        if (['completed', 'cancelled', 'failed', 'paused', 'recoverable'].includes(previous.status)
          && ['queued', 'transferring'].includes(task.status)) continue
        if (task.transferred < previous.transferred && task.status === previous.status) continue
      }
    }
    tasks.set(task.id, task)
  }
  return [...tasks.values()]
}
