import type { TransferTask } from '@/types/sftp'

export function transferPhaseLabel(task: TransferTask): string {
  switch (task.phase) {
    case 'scanning': return '扫描目录'
    case 'archiving': return '打包文件'
    case 'preparing': return '准备文件'
    case 'verifying': return '检查文件'
    case 'committing': return '提交文件'
    default: return task.transferred >= task.size ? '正在完成' : '传输中'
  }
}

/** 100% means the staging file has actually been committed. */
export function transferProgress(task: TransferTask): number {
  if (task.status === 'completed') return 100
  const ratio = task.size > 0 ? task.transferred / task.size
    : task.items_total ? (task.items_completed ?? 0) / task.items_total : 0
  return Math.min(99, Math.floor(ratio * 100))
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
        if ((task.items_completed ?? 0) < (previous.items_completed ?? 0) && task.status === previous.status) continue
      }
    }
    tasks.set(task.id, task)
  }
  return [...tasks.values()]
}
