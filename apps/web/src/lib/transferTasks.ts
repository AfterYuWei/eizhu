import type { TransferTask } from '@/types/sftp'

export function transferPhaseLabel(task: TransferTask): string {
  switch (task.phase) {
    case 'preparing': return '准备文件'
    case 'verifying': return '检查文件'
    case 'committing': return '提交文件'
    default: return task.transferred >= task.size ? '正在完成' : '传输中'
  }
}

/** 100% means the staging file has actually been committed. */
export function transferProgress(task: TransferTask): number {
  if (task.status === 'completed') return 100
  return task.size > 0 ? Math.min(99, Math.floor((task.transferred / task.size) * 100)) : 0
}

/** The business process owns execution generations and confirmed offsets. Ignore delayed events. */
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
