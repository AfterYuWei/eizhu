import { workspaceGeneration } from '@/lib/workspaceScope'
import { invoke } from '@tauri-apps/api/core'
import { invokeCommand, normalizeCommandError } from './tauri'
import { isMobileRuntime } from '@/lib/platform'
import type {
  SftpEntry,
  TransferTask,
  ConflictResolution,
  SftpCreateSessionResponse,
  SftpListResponse,
  SftpTreeResponse,
  SftpTransferResponse,
  SftpUploadResponse,
  SftpUploadBeginResponse,
  SftpDownloadResponse,
  SftpDeleteResponse,
  SftpFileReadResponse,
  SftpFileWriteRequest,
  SftpFileWriteResponse,
  DirectoryTransferMode,
  SftpMoveResponse,
} from '@/types/sftp'

const IPC_CHUNK_BYTES = 512 * 1024
const USE_BASE64_IPC = isMobileRuntime()

/** Rust SFTP session info. */
export interface SftpSessionInfo {
  id: string
  profile_id: string
  status: string
  error?: string
  home_dir?: string // User's home directory
  created_at: string
  host_key_fingerprint?: string
  known_host_key_fingerprint?: string
}

export const sftpApi = {
  // --- Session management ---

  createSession: (profileId: string) =>
    invokeCommand<SftpCreateSessionResponse>('sftp_create_session', { profileId }),

  getSession: (id: string) =>
    invokeCommand<SftpSessionInfo>('sftp_get_session', { id }),

  reconnectSession: (id: string) =>
    invokeCommand<SftpCreateSessionResponse>('sftp_reconnect_session', { id }),

  decideHostKey: (
    requestId: string,
    fingerprint: string,
    decision: 'trust_once' | 'trust_permanently' | 'reject',
  ) => invokeCommand<{ status: string; persisted?: boolean }>('sftp_host_key_decide', {
    requestId,
    fingerprint,
    decision,
  }),

  listSessions: () =>
    invokeCommand<SftpSessionInfo[]>('sftp_list_sessions'),

  closeSession: (id: string) =>
    invokeCommand<void>('sftp_close_session', { id }),

  // --- File operations ---

  list: (sessionId: string, path: string, showHidden = false) =>
    invokeCommand<SftpListResponse>('sftp_list', { sessionId, path, showHidden }),

  stat: (sessionId: string, path: string) =>
    invokeCommand<SftpEntry>('sftp_stat', { sessionId, path }),

  tree: (sessionId: string, path: string, depth = 3) =>
    invokeCommand<SftpTreeResponse>('sftp_tree', { sessionId, path, depth }),

  mkdir: (sessionId: string, path: string) =>
    invokeCommand<SftpEntry>('sftp_mkdir', { sessionId, path }),

  rename: (sessionId: string, oldPath: string, newPath: string) =>
    invokeCommand<SftpEntry>('sftp_rename', { sessionId, oldPath, newPath }),

  delete: (sessionId: string, paths: string[]) =>
    invokeCommand<SftpDeleteResponse>('sftp_delete', { sessionId, paths }),

  // --- Transfers ---

  /** Cross-session transfer: tries direct server-to-server copy first, falls
   *  back to backend relay if direct is not possible.
   *  If conflictResolution is "ask" (default) and the target has existing
   *  files, resolves with a `conflicts` array instead of starting a transfer.
   *  Pass "overwrite" | "rename" | "skip" to proceed without prompting. */
  transfer: async (
    sourceSessionId: string,
    targetSessionId: string,
    paths: string[],
    destDir: string,
    conflictResolution: ConflictResolution = 'ask',
    directoryMode: DirectoryTransferMode = 'archive',
  ): Promise<SftpTransferResponse> => {
    return invokeCommand<SftpTransferResponse>('sftp_transfer', {
        sourceSessionId,
        targetSessionId,
        paths,
        destDir,
        conflictResolution,
        directoryMode,
    })
  },

  move: async (
    sessionId: string,
    paths: string[],
    destDir: string,
    conflictResolution: ConflictResolution = 'ask',
  ): Promise<SftpMoveResponse> => {
    return invokeCommand<SftpMoveResponse>('sftp_move', {
      sessionId,
      paths,
      destDir,
      conflictResolution,
    })
  },

  /** Stream files through bounded raw IPC chunks. Each invoke completes only
   *  after Rust wrote the chunk, providing end-to-end backpressure. */
  upload: async (
    sessionId: string,
    files: File[],
    destDir: string,
    overwrite = false,
    onTasks?: (tasks: TransferTask[]) => void,
  ) => {
    const generation = workspaceGeneration()
    const responses: SftpUploadResponse[] = []
    for (const file of files) {
      assertWorkspace(generation)
      const begin = await invokeCommand<SftpUploadBeginResponse>('sftp_upload_begin', {
        sessionId, name: file.name, destDir, overwrite, size: file.size, lastModified: file.lastModified,
      })
      assertWorkspace(generation)
      onTasks?.(begin.tasks)
      responses.push(await sendUpload(file, begin, generation))
    }
    return { tasks: responses.flatMap((response) => response.tasks) }
  },

  resumeUpload: async (taskId: string, file: File, restart = false, onTasks?: (tasks: TransferTask[]) => void) => {
    const generation = workspaceGeneration()
    const checkpoint = await invokeCommand<{
      size: number; last_modified?: number; blocks: { length: number; sha256: string }[]
    }>('sftp_upload_checkpoint', { taskId })
    const digests: string[] = []
    if (!restart) {
      if (file.size !== checkpoint.size || (checkpoint.last_modified !== undefined && file.lastModified !== checkpoint.last_modified)) {
        throw new Error('所选文件的大小或修改时间已变化，请选择原文件或重新开始')
      }
      let offset = 0
      for (const block of checkpoint.blocks) {
        assertWorkspace(generation)
        const hash = await crypto.subtle.digest('SHA-256', await file.slice(offset, offset + block.length).arrayBuffer())
        const digest = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
        if (digest !== block.sha256) throw new Error('所选文件已传部分发生变化，请选择原文件或重新开始')
        digests.push(digest)
        offset += block.length
      }
    }
    assertWorkspace(generation)
    const begin = await invokeCommand<SftpUploadBeginResponse>('sftp_resume_upload', {
      taskId, size: file.size, lastModified: file.lastModified, digests, restart,
    })
    assertWorkspace(generation)
    onTasks?.(begin.tasks)
    if (!begin.upload_id) return { tasks: begin.tasks }
    return sendUpload(file.slice(begin.received ?? 0), begin, generation)
  },

  pauseTransfer: (taskId: string) => invokeCommand<TransferTask>('sftp_pause_transfer', { taskId }),
  resumeTransfer: (taskId: string) => invokeCommand<TransferTask>('sftp_resume_transfer', { taskId }),
  retryTransfer: (taskId: string, restart = false) => invokeCommand<TransferTask>('sftp_retry_transfer', { taskId, restart }),

  uploadDocument: (
    sessionId: string,
    reference: string,
    destDir: string,
    conflictResolution: ConflictResolution = 'ask',
  ) => invokeCommand<SftpUploadResponse>('sftp_upload_document', {
    sessionId,
    reference,
    destDir,
    conflictResolution,
  }),

  /** Stage remote files in Rust without loading them into memory. */
  download: (sessionId: string, paths: string[]) =>
    invokeCommand<SftpDownloadResponse>('sftp_download', { sessionId, paths }),

  exportDownload: (taskId: string) =>
    invokeCommand<string | null>('sftp_export_download', { taskId }),

  downloadToDocuments: async (
    sessionId: string,
    paths: string[],
    onTasks?: (tasks: TransferTask[]) => void,
    onProgress?: (task: TransferTask) => void,
  ) => {
    const response = await invokeCommand<SftpDownloadResponse>('sftp_download', { sessionId, paths })
    onTasks?.(response.tasks)
    for (const task of response.tasks) {
      while (true) {
        const current = (await invokeCommand<TransferTask[]>('sftp_list_transfers', { sessionId }))
          .find((candidate) => candidate.id === task.id)
        if (!current) throw new Error('下载任务已丢失')
        onProgress?.(current)
        if (['failed', 'cancelled', 'paused', 'recoverable'].includes(current.status)) {
          throw new Error(current.error_message || '下载未完成')
        }
        if (current.status === 'completed') break
        await new Promise((resolve) => setTimeout(resolve, 350))
      }
      await invokeCommand<string | null>('sftp_export_download', { taskId: task.id })
    }
    return response
  },

  /** Pull a completed staged download as a backpressured byte stream. */
  streamDownloadFile: (taskId: string): ReadableStream<Uint8Array> => {
    let offset = 0
    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      await invokeCommand<void>('sftp_download_close', { taskId })
    }
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = USE_BASE64_IPC
            ? base64ToBytes(await invokeCommand<string>('sftp_download_chunk_base64', {
                taskId,
                offset,
                maxBytes: IPC_CHUNK_BYTES,
              }))
            : toUint8Array(await invoke<ArrayBuffer | Uint8Array>('sftp_download_chunk', {
                taskId,
                offset,
                maxBytes: IPC_CHUNK_BYTES,
              }))
          if (chunk.byteLength === 0) {
            controller.close()
            await close()
            return
          }
          offset += chunk.byteLength
          controller.enqueue(chunk)
        } catch (cause) {
          controller.error(normalizeCommandError(cause))
          try {
            await close()
          } catch {
            // Preserve the original download error.
          }
        }
      },
      async cancel() {
        await close()
      },
    })
  },

  listTransfers: (sessionId?: string, status?: string) => {
    return invokeCommand<TransferTask[]>('sftp_list_transfers', { sessionId, status })
  },

  cancelTransfer: (taskId: string) =>
    invokeCommand<TransferTask>('sftp_cancel_transfer', { taskId }),

  clearCompletedTransfers: () =>
    invokeCommand<void>('sftp_clear_completed_transfers'),

  // --- Built-in editor ---

  /** Read a remote file as text for editing. Backend guards: >10MB → 413,
   *  binary → 415, non-UTF-8 → 415. Returns content + optimistic-lock token
   *  (mod_time) + Monaco language hint. */
  readFile: (sessionId: string, path: string) =>
    invokeCommand<SftpFileReadResponse>('sftp_read_file', { sessionId, path }),

  /** Write edited content back. Uses optimistic locking via expected_mod_time;
   *  mismatch → 409 FILE_MODIFIED. Returns the new mod_time for the next save. */
  writeFile: (sessionId: string, path: string, body: SftpFileWriteRequest) =>
    invokeCommand<SftpFileWriteResponse>('sftp_write_file', { sessionId, path, request: body }),
}

function toUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.byteLength; offset += 32 * 1024) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32 * 1024))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function assertWorkspace(generation: number | undefined) {
  if (generation !== workspaceGeneration()) throw normalizeCommandError({ code: 'WORKSPACE_CHANGED', message: '数据空间已切换，请重试' })
}

async function sendUpload(file: Blob, begin: SftpUploadBeginResponse, generation: number | undefined): Promise<SftpUploadResponse> {
  const uploadId = begin.upload_id
  const reader = file.stream().getReader()
  let sequence = begin.sequence ?? 0
  try {
    while (true) {
      assertWorkspace(generation)
      const { done, value } = await reader.read()
      assertWorkspace(generation)
      if (done) break
      for (let offset = 0; offset < value.byteLength; offset += IPC_CHUNK_BYTES) {
        assertWorkspace(generation)
        const chunk = value.subarray(offset, offset + IPC_CHUNK_BYTES)
        if (USE_BASE64_IPC) {
          await invokeCommand('sftp_upload_chunk_base64', { uploadId, data: bytesToBase64(chunk), sequence })
        } else {
          await invoke('sftp_upload_chunk', chunk, { headers: {
            'x-eizhu-upload-id': uploadId,
            'x-eizhu-chunk-sequence': String(sequence),
            ...(generation !== undefined ? { 'x-eizhu-workspace-generation': String(generation) } : {}),
          } })
        }
        assertWorkspace(generation)
        sequence++
      }
    }
    return await invokeCommand<SftpUploadResponse>('sftp_upload_finish', { uploadId })
  } catch (cause) {
    if (generation === workspaceGeneration() && begin.tasks[0]) {
      try { await sftpApi.pauseTransfer(begin.tasks[0].id) } catch { /* Keep the original error and durable checkpoint. */ }
    }
    throw normalizeCommandError(cause)
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
