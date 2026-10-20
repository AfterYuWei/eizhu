import { bridge } from '@/lib/bridge'
import { sftpApi } from './sftp'
import type { SftpEntry, SftpListResponse } from '@/types/sftp'
import type { ServerSessionResponse } from '@eizhu/contracts/models/api'

// --- Types ---

export type { ServerSessionResponse } from '@eizhu/contracts/models/api'

export type { ServerInfo } from '@eizhu/contracts/models/api'

export type { NetIfStat } from '@eizhu/contracts/models/api'

export type { ProcMem } from '@eizhu/contracts/models/api'

export type { ServerMetrics } from '@eizhu/contracts/models/api'

// Re-export unified types from sftp (backend returns SftpEntry format)
export type { SftpEntry, SftpListResponse }

// --- API ---

export const serverDetailApi = {
  createSession: (profileId: string): Promise<ServerSessionResponse> =>
    bridge().serverDetail.create({ profileId }),

  closeSession: (sessionId: string) => bridge().serverDetail.close({ sessionId }),

  getInfo: (sessionId: string) => bridge().serverDetail.getInfo({ sessionId }),

  listFiles: (sessionId: string, path: string, showHidden = false) =>
    bridge().serverDetail.listFiles({ sessionId, path, showHidden }),

  mkdir: (sessionId: string, path: string) => sftpApi.mkdir(sessionId, path),

  rename: (sessionId: string, oldPath: string, newPath: string) =>
    sftpApi.rename(sessionId, oldPath, newPath),

  delete: (sessionId: string, paths: string[]) => sftpApi.delete(sessionId, paths),

  getMetrics: (sessionId: string) => bridge().serverDetail.getMetrics({ sessionId }),
}
