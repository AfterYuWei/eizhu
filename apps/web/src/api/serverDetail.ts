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
  createSession: async (profileId: string): Promise<ServerSessionResponse> => {
    const response = await sftpApi.createSession(profileId)
    let status = response.status
    let homeDir = response.home_dir
    const deadline = Date.now() + 30_000
    while (status === 'connecting' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const session = await sftpApi.getSession(response.session_id)
      if (session.error) throw new Error(session.error)
      status = session.status
      homeDir = session.home_dir ?? homeDir
    }
    if (status !== 'connected') throw new Error(`连接失败: ${status}`)
    return { session_id: response.session_id, status, home_dir: homeDir }
  },

  closeSession: (sessionId: string) => sftpApi.closeSession(sessionId),

  getInfo: (sessionId: string) => bridge().serverDetail.getInfo({ sessionId }),

  listFiles: (sessionId: string, path: string, showHidden = false) =>
    sftpApi.list(sessionId, path, showHidden),

  mkdir: (sessionId: string, path: string) => sftpApi.mkdir(sessionId, path),

  rename: (sessionId: string, oldPath: string, newPath: string) =>
    sftpApi.rename(sessionId, oldPath, newPath),

  delete: (sessionId: string, paths: string[]) => sftpApi.delete(sessionId, paths),

  getMetrics: (sessionId: string) => bridge().serverDetail.getMetrics({ sessionId }),
}
