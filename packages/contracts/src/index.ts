import type { DomainOperations } from './domains.ts'
import type { FoundationInput, FoundationOperation, FoundationOutput } from './foundation.ts'
import type { SessionMessage } from './models/sessionMessage.ts'
import type { WorkspaceStatus } from './foundation.ts'
import type { SyncStatus } from './models/sync.ts'
import type { TransferTask } from './models/sftp.ts'
import type { TunnelStatus } from './models/api.ts'
export * from './foundation.ts'
export * from './errors.ts'
export * from './logging.ts'
export * from './events.ts'
export * from './local.ts'
export * from './ssh.ts'
export * from './sftp.ts'
export { archive, isArchiveOperation, backupSettingsSchema, providerConfigSchema, targetSchema, versionSchema, cloudIndexSchema } from './archive.ts'
export type { ArchiveOperation, CloudIndex, CloudEntry } from './archive.ts'
export { reservedOperations } from './domains.ts'
export type { DomainOperations }

type DomainName = keyof DomainOperations extends `${infer D}.${string}` ? D : never
type DomainMethod<D extends string, K extends keyof DomainOperations> = K extends `${D}.${infer M}`
  ? M
  : never
type DomainCall<K extends keyof DomainOperations> = DomainOperations[K]['input'] extends void
  ? () => Promise<DomainOperations[K]['output']>
  : (input: DomainOperations[K]['input']) => Promise<DomainOperations[K]['output']>
export type DomainClient = {
  [D in DomainName]: { [K in keyof DomainOperations as DomainMethod<D, K>]: DomainCall<K> }
}
type FoundationClient = {
  [D in FoundationOperation extends `${infer N}.${string}` ? N : never]: {
    [
      K in FoundationOperation as K extends `${D}.${infer M}` ? M : never
    ]: FoundationInput<K> extends undefined
      ? () => Promise<FoundationOutput<K>>
      : (input: FoundationInput<K>) => Promise<FoundationOutput<K>>
  }
}
export interface DesktopEvents {
  'eizhu-workspace-changed': WorkspaceStatus
  'eizhu-sync-message': { workspaceGeneration: number; status: SyncStatus }
  'eizhu-session-message': (
    | SessionMessage
    | {
        type: 'tunnel_status' | 'tunnel_auth_closed' | 'tunnel_auth_request' | 'tunnel_host_key_request'
        payload: unknown
        session_id: string
      }
  ) & { workspaceGeneration?: number }
  'eizhu-sftp-message': {
    type: string
    payload?: Partial<TransferTask> & { task_id?: string; session_id?: string }
    workspaceGeneration?: number
  }
  'eizhu-transfer-message': TransferTask
  'eizhu-tunnel-status': { workspaceGeneration: number; status: TunnelStatus }
  'eizhu-editor-open-file': { sessionId: string; sessionType: 'sftp' | 'serverDetail'; path: string }
  'eizhu-editor-transition': { requestId: string }
  'eizhu-app-close-request': { requestId: string }
  'eizhu-window-close-request': {requestId:string}
  'eizhu-window-state': { maximized: boolean }
  'eizhu-runtime-state': { status: 'ready' | 'failed'; message?: string }
  'eizhu-settings-changed': FoundationInput<'settings.write'>
}
export type DesktopApi = Omit<DomainClient, 'session'> &
  FoundationClient & {
    session: Omit<DomainClient['session'], 'subscribe'> & {
      subscribe: (input: { id: string }, callback: (message: SessionMessage) => void | Promise<void>) => Promise<string>
    }
    events: {
      on<K extends keyof DesktopEvents>(name: K, callback: (payload: DesktopEvents[K]) => void): () => void
    }
    files: { pathForFile(file: File): string }
  }
