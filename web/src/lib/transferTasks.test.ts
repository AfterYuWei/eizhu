import { describe, it, expect } from 'vitest'
import { mergeTransferTasks } from './transferTasks'
import type { TransferTask } from '@/types/sftp'
const task = (changes: Partial<TransferTask> = {}): TransferTask => ({
  id: 'one', file_name: '中文 空格.txt', direction: 'transfer', size: 8, transferred: 4,
  speed: 0, started_at: 1, status: 'paused', execution_generation: 2, ...changes,
})
describe('任务检查点合并', () => {
  it('丢弃旧执行代次、结束后的迟到进度和回退偏移', () => {
    const current = task()
    expect(mergeTransferTasks([current], [task({ status: 'transferring', execution_generation: 1 })])).toEqual([current])
    expect(mergeTransferTasks([current], [task({ status: 'transferring', transferred: 8 })])).toEqual([current])
    const running = task({ status: 'transferring' })
    expect(mergeTransferTasks([running], [task({ status: 'transferring', transferred: 2 })])).toEqual([running])
  })
  it('接受新代次重新开始、保留错误详情并汇集不同会话任务', () => {
    const restarted = task({ status: 'queued', transferred: 0, execution_generation: 3 })
    expect(mergeTransferTasks([task()], [restarted, task({ id: 'two', error_code: 'DISK_FULL', status: 'failed' })]))
      .toEqual([restarted, task({ id: 'two', error_code: 'DISK_FULL', status: 'failed' })])
  })
})
