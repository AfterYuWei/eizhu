import { workspaceGeneration } from '@/lib/workspaceScope'
import { normalizeCommandError } from '@eizhu/contracts'
import { bridge } from '@/lib/bridge'
import type {
  TransferTask,
  ConflictResolution,
  SftpTransferResponse,
  SftpUploadResponse,
  SftpUploadBeginResponse,
  SftpFileWriteRequest,
  DirectoryTransferMode,
  SftpMoveResponse,
} from '@/types/sftp'

const IPC_CHUNK_BYTES = 512 * 1024

/** Node.js SFTP session info. */
export type { SftpSessionInfo } from '@eizhu/contracts/models/api'

export const sftpApi = {
  // --- Session management ---

  createSession: (profileId: string) => bridge().sftp.createSession({ profileId }),

  getSession: (id: string) => bridge().sftp.getSession({ id }),

  reconnectSession: (id: string) => bridge().sftp.reconnectSession({ id }),

  decideHostKey: (
    requestId: string,
    fingerprint: string,
    decision: 'trust_once' | 'trust_permanently' | 'reject',
  ) =>
    bridge().sftp.hostKeyDecide({
      requestId,
      fingerprint,
      decision,
    }),

  listSessions: () => bridge().sftp.listSessions(),

  closeSession: (id: string) => bridge().sftp.closeSession({ id }),

  // --- File operations ---

  list: (sessionId: string, path: string, showHidden = false) =>
    bridge().sftp.list({ sessionId, path, showHidden }),

  stat: (sessionId: string, path: string) => bridge().sftp.stat({ sessionId, path }),

  tree: (sessionId: string, path: string, depth = 3) => bridge().sftp.tree({ sessionId, path, depth }),

  mkdir: (sessionId: string, path: string) => bridge().sftp.mkdir({ sessionId, path }),

  rename: (sessionId: string, oldPath: string, newPath: string) =>
    bridge().sftp.rename({ sessionId, oldPath, newPath }),

  delete: (sessionId: string, paths: string[]) => bridge().sftp.delete({ sessionId, paths }),

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
    return bridge().sftp.transfer({
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
    return bridge().sftp.move({
      sessionId,
      paths,
      destDir,
      conflictResolution,
    })
  },

  /** Stream files through bounded raw IPC chunks. Each invoke completes only
   *  after Node.js wrote the chunk, providing end-to-end backpressure. */
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
      const begin = await bridge().sftp.uploadBegin({
        sessionId,
        name: file.name,
        destDir,
        overwrite,
        size: file.size,
        lastModified: file.lastModified,
      })
      assertWorkspace(generation)
      onTasks?.(begin.tasks)
      responses.push(await sendUpload(file, begin, generation))
    }
    return { tasks: responses.flatMap((response) => response.tasks) }
  },

  resumeUpload: async (
    taskId: string,
    file: File,
    restart = false,
    onTasks?: (tasks: TransferTask[]) => void,
  ) => {
    const generation = workspaceGeneration()
    const checkpoint = await bridge().sftp.uploadCheckpoint({ taskId })
    if (!restart) {
      if (
        file.size !== checkpoint.size ||
        (checkpoint.last_modified != null && file.lastModified !== checkpoint.last_modified)
      ) {
        throw new Error('所选文件的大小或修改时间已变化，请选择原文件或重新开始')
      }
    }
    assertWorkspace(generation)
    const begin = await bridge().sftp.resumeUpload({
      taskId,
      size: file.size,
      lastModified: file.lastModified,
      restart,
    })
    assertWorkspace(generation)
    onTasks?.(begin.tasks)
    if (!begin.upload_id) return { tasks: begin.tasks }
    return sendUpload(file.slice(begin.received ?? 0), begin, generation)
  },

  pauseTransfer: (taskId: string) => bridge().sftp.pauseTransfer({ taskId }),
  resumeTransfer: (taskId: string) => bridge().sftp.resumeTransfer({ taskId }),
  retryTransfer: (taskId: string, restart = false) => bridge().sftp.retryTransfer({ taskId, restart }),

  /** Stage remote files in Node.js without loading them into memory. */
  download: (sessionId: string, paths: string[]) => bridge().sftp.download({ sessionId, paths }),

  exportDownload: (taskId: string) => bridge().sftp.exportDownload({ taskId }),

  /** Pull a completed staged download as a backpressured byte stream. */
  streamDownloadFile: (taskId: string): ReadableStream<Uint8Array> => {
    let offset = 0
    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      await bridge().sftp.downloadClose({ taskId })
    }
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = toUint8Array(
            await bridge().sftp.downloadChunk({ taskId, offset, maxBytes: IPC_CHUNK_BYTES }),
          )
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
    return bridge().sftp.listTransfers({ sessionId, status })
  },

  cancelTransfer: (taskId: string) => bridge().sftp.cancelTransfer({ taskId }),

  clearCompletedTransfers: () => bridge().sftp.clearCompletedTransfers(),

  // --- Built-in editor ---

  /** Read a remote file as text for editing. Backend guards: >10MB → 413,
   *  binary → 415, non-UTF-8 → 415. Returns content + optimistic-lock token
   *  (mod_time) + Monaco language hint. */
  readFile: (sessionId: string, path: string) => bridge().sftp.readFile({ sessionId, path }),

  /** Write edited content back. Uses optimistic locking via expected_mod_time;
   *  mismatch → 409 FILE_MODIFIED. Returns the new mod_time for the next save. */
  writeFile: (sessionId: string, path: string, body: SftpFileWriteRequest) =>
    bridge().sftp.writeFile({ sessionId, path, request: body }),
}

function toUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

function assertWorkspace(generation: number | undefined) {
  if (generation !== workspaceGeneration())
    throw normalizeCommandError({ code: 'WORKSPACE_CHANGED', message: '数据空间已切换，请重试' })
}

async function sendUpload(
  file: Blob,
  begin: SftpUploadBeginResponse,
  generation: number | undefined,
): Promise<SftpUploadResponse> {
  const uploadId = begin.upload_id
  const reader = file.stream().getReader()
  let sequence = begin.sequence ?? 0
  const buffer = new Uint8Array(IPC_CHUNK_BYTES)
  let buffered = 0
  const sendChunk = async (chunk: Uint8Array) => {
    assertWorkspace(generation)
    await bridge().sftp.uploadChunk({ uploadId, data: chunk, sequence })
    assertWorkspace(generation)
    sequence++
  }
  try {
    while (true) {
      assertWorkspace(generation)
      const { done, value } = await reader.read()
      assertWorkspace(generation)
      if (done) break
      // File.stream() commonly yields 64 KiB. Coalesce those fragments so each
      // durable Node.js checkpoint and IPC round trip carries a full bounded block.
      for (let offset = 0; offset < value.byteLength;) {
        const length = Math.min(IPC_CHUNK_BYTES - buffered, value.byteLength - offset)
        buffer.set(value.subarray(offset, offset + length), buffered)
        buffered += length
        offset += length
        if (buffered === IPC_CHUNK_BYTES) {
          await sendChunk(buffer)
          buffered = 0
        }
      }
    }
    if (buffered > 0) await sendChunk(buffer.subarray(0, buffered))
    return await bridge().sftp.uploadFinish({ uploadId })
  } catch (cause) {
    if (generation === workspaceGeneration() && begin.tasks[0]) {
      try {
        await sftpApi.pauseTransfer(begin.tasks[0].id)
      } catch {
        /* Keep the original error and durable checkpoint. */
      }
    }
    throw normalizeCommandError(cause)
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
