import { expect, it } from 'vitest'
import { mergeStatuses } from './tunnelStatuses'
import type { TunnelStatus } from '@/api/tunnel'
it('忽略旧执行代次和同代次迟到状态，避免停止后恢复为运行', () => {
  const stopped: TunnelStatus = { id: 'a', generation: 2, revision: 10, status: 'stopped', bound_port: null, active_connections: 0, retry_attempt: 0, error_code: null, error_message: null }
  expect(mergeStatuses({ a: stopped }, [{ ...stopped, generation: 1, revision: 20, status: 'running' }])).toEqual({ a: stopped })
  expect(mergeStatuses({ a: stopped }, [{ ...stopped, revision: 9, status: 'running' }])).toEqual({ a: stopped })
  const restarted = { ...stopped, generation: 3, revision: 0, status: 'connecting' as const }
  expect(mergeStatuses({ a: stopped }, [restarted])).toEqual({ a: restarted })
})
