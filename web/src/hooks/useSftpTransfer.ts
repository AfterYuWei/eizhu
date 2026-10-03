import { workspaceGeneration } from '@/lib/workspaceScope'
import { useEffect, useRef } from 'react'
import type { TransferTask } from '@/types/sftp'
import { listen } from '@tauri-apps/api/event'

interface SftpEvent {
  workspaceGeneration?: number
  type: string
  payload?: Partial<TransferTask> & { task_id?: string; session_id?: string }
}

export interface SftpTransferCallbacks {
  onTask?: (task: TransferTask) => void
  onProgress?: (taskId: string, transferred: number, size: number, speed: number, status: string) => void
  onComplete?: (taskId: string, status: string, finishedAt: number) => void
  onFailed?: (taskId: string, status: string, errorMessage: string) => void
  onSessionStatus?: (sessionId: string, status: string) => void
}

/** 订阅 Rust SFTP 领域通过 Tauri event 推送的会话状态与传输进度。 */
export function useSftpTransfer(sessionIds: string | string[] | null, callbacks: SftpTransferCallbacks) {
  const sessionKey = JSON.stringify(sessionIds)
  const callbacksRef = useRef(callbacks)

  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

  useEffect(() => {
    const owned = JSON.parse(sessionKey) as string | string[] | null
    const ids = new Set(typeof owned === 'string' ? [owned] : owned ?? [])
    const generation = workspaceGeneration()
    let disposed = false
    let cleanup: (() => void) | undefined

    void listen<SftpEvent>('eizhu-sftp-message', ({ payload: message }) => {
      if (disposed || generation !== workspaceGeneration()) return
      if (message.workspaceGeneration !== undefined && message.workspaceGeneration !== workspaceGeneration()) return
      const payload = message.payload ?? {}
      const eventSessionId = payload.session_id
      if (message.type === 'sftp_session_status' && eventSessionId && !ids.has(eventSessionId)) return
      if (message.type.startsWith('transfer_') && payload.file_name && payload.status) {
        callbacksRef.current.onTask?.({ ...payload, id: payload.id ?? payload.task_id ?? '' } as TransferTask)
      }
      switch (message.type) {
        case 'transfer_progress':
          callbacksRef.current.onProgress?.(
            payload.task_id ?? '', payload.transferred ?? 0, payload.size ?? 0,
            payload.speed ?? 0, payload.status ?? '',
          )
          break
        case 'transfer_complete':
          callbacksRef.current.onComplete?.(
            payload.task_id ?? '', payload.status ?? 'completed', payload.finished_at ?? Date.now(),
          )
          break
        case 'transfer_failed':
          callbacksRef.current.onFailed?.(
            payload.task_id ?? '', payload.status ?? 'failed', payload.error_message ?? 'unknown error',
          )
          break
        case 'sftp_session_status':
          callbacksRef.current.onSessionStatus?.(payload.session_id ?? '', payload.status ?? '')
          break
      }
    }).then((unlisten) => {
      if (disposed) unlisten()
      else cleanup = unlisten
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [sessionKey])
}
