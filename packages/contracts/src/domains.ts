import type {
  TransferTask,
  ConflictResolution,
  SftpCreateSessionResponse,
  SftpTreeResponse,
  SftpTransferResponse,
  SftpUploadResponse,
  SftpUploadBeginResponse,
  SftpDownloadResponse,
  SftpDeleteResponse,
  DirectoryTransferMode,
  SftpMoveResponse,
} from './models/sftp.ts'
import type { SftpSessionInfo } from './models/api.ts'
import type { Session, SessionCreateRequest, SessionCreateResponse } from './models/session.ts'
import type { SessionMessage } from './models/sessionMessage.ts'
import type {
  SftpEntry,
  SftpListResponse,
  SftpFileReadResponse,
  SftpFileWriteRequest,
  SftpFileWriteResponse,
} from './models/sftp.ts'
import type {
  Profile,
  ProfileCreateRequest,
  ProfileTestResult,
  ProfileUpdateRequest,
} from './models/profile.ts'
import type { Group, GroupCreateRequest, GroupUpdateRequest } from './models/group.ts'
import type {
  VaultItem,
  VaultCredential,
  VaultCreateRequest,
  VaultUpdateRequest,
  GenerateKeyRequest,
  GenerateKeyResponse,
  ProfileRef,
} from './models/vault.ts'
import type { SyncStatus, SyncConflict, SyncPreview } from './models/sync.ts'
import type { AccountStatus, AccountUser } from './models/account.ts'
import type {
  BackupSettings,
  BackupStatus,
  BackupVersion,
  BackupEvent,
  BackupTargetMeta,
  ProviderConfig,
  RestorePreview,
} from './models/backup.ts'
import type { Snippet, SnippetCreateRequest, SnippetUpdateRequest } from './models/snippet.ts'
import type {
  ServerInfo,
  ServerMetrics,
  HistoryEntry,
  LocalStateKey,
  TunnelConfig,
  TunnelStatus,
  CredentialMode,
  ImportStrategy,
  BackupPreview,
  BackupImportResult,
  DocumentDescriptor,
} from './models/api.ts'

/** Reserved domain contracts. Each operation is enabled with its runtime schema in its delivery stage. */
export interface DomainOperations {
  'audit.list': {
    input: { limit: number }
    output: Array<{ id: string; action: string; entity_id: string; created_at: string }>
  }
  'audit.clear': { input: void; output: void }
  'backup.prepareRestore': { input: { filePath: string; password?: string }; output: RestorePreview }
  'account.login': { input: { email: string; password: string }; output: AccountStatus }
  'account.logout': { input: void; output: void }
  'account.me': { input: void; output: AccountUser }
  'account.register': { input: { email: string; password: string }; output: AccountStatus }
  'account.requestPasswordReset': { input: { email: string }; output: void }
  'account.resetPassword': { input: { email: string; code: string; newPassword: string }; output: void }
  'account.sendVerificationEmail': { input: void; output: void }
  'account.setSyncEnabled': { input: { enabled: boolean }; output: AccountStatus }
  'account.status': { input: void; output: AccountStatus }
  'account.verifyEmail': { input: { code: string }; output: void }
  'backup.applyRestore': { input: { token: string; mode: 'merge' | 'replace' }; output: void }
  'backup.backupNow': { input: void; output: { created: boolean; message?: string; version?: BackupVersion } }
  'backup.cloudVersions': {
    input: { providerId: string }
    output: Array<{ object: string; size: number; createdAt: string }>
  }
  'backup.createProvider': { input: { config: ProviderConfig }; output: BackupTargetMeta }
  'backup.deleteProvider': { input: { id: string }; output: void }
  'backup.deleteVersion': { input: { id: string; force: boolean }; output: void }
  'backup.events': { input: { limit: number }; output: BackupEvent[] }
  'backup.export': { input: { mode: CredentialMode; password: string | undefined }; output: string | null }
  'backup.getSettings': { input: void; output: BackupSettings }
  'backup.import': {
    input: { filePath: string; strategy: ImportStrategy; password: string | undefined }
    output: BackupImportResult
  }
  'backup.oauthUrl': {
    input: { providerType: 'gdrive' | 'onedrive'; providerId: string }
    output: { url: string }
  }
  'backup.pickFile': { input: void; output: { name: string; reference: string } | string | null }
  'backup.preview': { input: { filePath: string; password: string | undefined }; output: BackupPreview }
  'backup.previewCloud': {
    input: { providerId: string; object: string; password: string | undefined }
    output: RestorePreview
  }
  'backup.previewLegacyAccount': { input: { password: string }; output: RestorePreview }
  'backup.previewSafety': { input: { id: string }; output: RestorePreview }
  'backup.previewVersion': { input: { id: string; password: string | undefined }; output: RestorePreview }
  'backup.push': { input: void; output: { started: boolean } }
  'backup.restoreVersion': { input: { id: string }; output: { restored: boolean } }
  'backup.revealPassword': { input: void; output: { backup_password: string } }
  'backup.safetyVersions': { input: void; output: Array<{ id: string; createdAt: string }> }
  'backup.status': { input: void; output: BackupStatus }
  'backup.submitLatest': { input: void; output: { started: boolean } }
  'backup.targets': { input: void; output: BackupTargetMeta[] }
  'backup.testProvider': { input: { id: string }; output: { saved: boolean } }
  'backup.updateProvider': { input: { id: string; config: ProviderConfig }; output: { saved: boolean } }
  'backup.updateSettings': {
    input: { settings: BackupSettings; backupPassword: string | undefined }
    output: { saved: boolean }
  }
  'backup.versions': { input: void; output: BackupVersion[] }
  'document.exportText': {
    input: { content: string; suggestedName: string; mimeType: string }
    output: string | null
  }
  'document.pick': { input: { multiple: boolean; mimeTypes: string[] }; output: DocumentDescriptor[] }
  'document.readText': { input: { reference: string; maxBytes: number }; output: string }
  'document.release': { input: { reference: string }; output: void }
  'group.create': { input: { request: GroupCreateRequest }; output: Group }
  'group.delete': { input: { id: string }; output: void }
  'group.list': { input: void; output: Group[] }
  'group.update': { input: { id: string; request: GroupUpdateRequest }; output: Group }
  'history.delete': { input: { profileId: string | undefined; id: string | undefined }; output: void }
  'history.list': { input: { profileId: string }; output: HistoryEntry[] }
  'history.record': { input: { profileId: string; command: string; cwd: string }; output: void }
  'localState.read': { input: { key: LocalStateKey }; output: unknown | null }
  'localState.write': { input: { key: LocalStateKey; value: unknown }; output: void }
  'profile.confirmHostKey': {
    input: { id: string; fingerprint: string }
    output: { ok: boolean; fingerprint: string }
  }
  'profile.create': { input: { request: ProfileCreateRequest }; output: Profile }
  'profile.delete': { input: { id: string }; output: void }
  'profile.get': { input: { id: string }; output: Profile }
  'profile.list': { input: { groupId: string | null; search: string | null }; output: Profile[] }
  'profile.testExisting': { input: { id: string; request: ProfileUpdateRequest }; output: ProfileTestResult }
  'profile.testNew': { input: { request: ProfileCreateRequest }; output: ProfileTestResult }
  'profile.update': { input: { id: string; request: ProfileUpdateRequest }; output: Profile }
  'serverDetail.create': { input: {profileId:string}; output: {session_id:string;status:string;home_dir?:string} }
  'serverDetail.close': {input:{sessionId:string};output:void}
  'serverDetail.listFiles': {input:{sessionId:string;path:string;showHidden:boolean};output:SftpListResponse}
  'serverDetail.getInfo': { input: { sessionId: string }; output: ServerInfo }
  'serverDetail.getMetrics': { input: { sessionId: string }; output: ServerMetrics }
  'session.attach': { input: { id: string }; output: SessionMessage[] }
  'session.authRespond': { input: { requestId: string; responses: string[] }; output: void }
  'session.close': { input: { id: string }; output: void }
  'session.complete': {
    input: import('./models/completion.ts').CompletionGeneratorRequest & {
      id: string
      requestId: string
      cwd?: string
    }
    output: void
  }
  'session.confirmHostKey': {
    input: { id: string; fingerprint: string | undefined }
    output: { status: string }
  }
  'session.create': { input: { request: SessionCreateRequest }; output: SessionCreateResponse }
  'session.decide': {
    input: { requestId: string; fingerprint: string; decision: 'trust_once' | 'trust_permanently' | 'reject' }
    output: { status: string; persisted?: boolean }
  }
  'session.input': { input: { id: string; data: string }; output: void }
  'session.list': { input: void; output: Session[] }
  'session.ping': { input: { id: string }; output: void }
  'session.reconnect': { input: { id: string }; output: SessionCreateResponse }
  'session.resize': { input: { id: string; cols: number; rows: number }; output: void }
  'session.subscribe': { input: { id: string }; output: string }
  'session.unsubscribe': { input: { id: string; subscriptionId: string }; output: void }
  'sftp.readFile': { input: { sessionId: string; path: string }; output: SftpFileReadResponse }
  'sftp.writeFile': {
    input: { sessionId: string; path: string; request: SftpFileWriteRequest }
    output: SftpFileWriteResponse
  }
  'snippet.create': { input: { request: SnippetCreateRequest }; output: Snippet }
  'snippet.delete': { input: { id: string }; output: void }
  'snippet.list': { input: void; output: Snippet[] }
  'snippet.update': { input: { id: string; request: SnippetUpdateRequest }; output: Snippet }
  'sync.bootstrap': { input: { token: string; mode: 'use_cloud' | 'merge' | 'use_local' }; output: void }
  'sync.changePassword': { input: { password: string }; output: void }
  'sync.conflicts': { input: void; output: SyncConflict[] }
  'sync.now': { input: void; output: void }
  'sync.preview': { input: void; output: SyncPreview }
  'sync.resolveConflict': {
    input: { itemType: string; itemId: string; choice: 'keep_local' | 'use_cloud'; remoteRevision: number }
    output: void
  }
  'sync.status': { input: void; output: SyncStatus }
  'sync.unlock': { input: { password: string }; output: void }
  'tunnel.delete': { input: { id: string }; output: void }
  'tunnel.list': { input: void; output: TunnelConfig[] }
  'tunnel.save': { input: { config: TunnelConfig }; output: TunnelConfig }
  'tunnel.start': { input: { id: string }; output: TunnelStatus }
  'tunnel.statuses': { input: void; output: TunnelStatus[] }
  'tunnel.stop': { input: { id: string }; output: void }
  'vault.create': { input: { request: VaultCreateRequest }; output: VaultItem }
  'vault.delete': { input: { id: string }; output: void }
  'vault.generateKeyPair': { input: { request: GenerateKeyRequest }; output: GenerateKeyResponse }
  'vault.get': { input: { id: string }; output: VaultItem }
  'vault.list': {
    input: { vaultType: import('./models/vault.ts').VaultType | null; q: string | null }
    output: VaultItem[]
  }
  'vault.references': { input: { id: string }; output: ProfileRef[] }
  'vault.reveal': { input: { id: string }; output: VaultCredential }
  'vault.update': { input: { id: string; request: VaultUpdateRequest }; output: VaultItem }
  'sftp.createSession': { input: { profileId: string }; output: SftpCreateSessionResponse }
  'sftp.getSession': { input: { id: string }; output: SftpSessionInfo }
  'sftp.reconnectSession': { input: { id: string }; output: SftpCreateSessionResponse }
  'sftp.hostKeyDecide': {
    input: { requestId: string; fingerprint: string; decision: 'trust_once' | 'trust_permanently' | 'reject' }
    output: { status: string; persisted?: boolean }
  }
  'sftp.listSessions': { input: void; output: SftpSessionInfo[] }
  'sftp.closeSession': { input: { id: string }; output: void }
  'sftp.list': { input: { sessionId: string; path: string; showHidden: boolean }; output: SftpListResponse }
  'sftp.stat': { input: { sessionId: string; path: string }; output: SftpEntry }
  'sftp.tree': { input: { sessionId: string; path: string; depth: number }; output: SftpTreeResponse }
  'sftp.mkdir': { input: { sessionId: string; path: string }; output: SftpEntry }
  'sftp.rename': { input: { sessionId: string; oldPath: string; newPath: string }; output: SftpEntry }
  'sftp.delete': { input: { sessionId: string; paths: string[] }; output: SftpDeleteResponse }
  'sftp.transfer': {
    input: {
      sourceSessionId: string
      targetSessionId: string
      paths: string[]
      destDir: string
      conflictResolution: ConflictResolution
      directoryMode: DirectoryTransferMode
    }
    output: SftpTransferResponse
  }
  'sftp.move': {
    input: { sessionId: string; paths: string[]; destDir: string; conflictResolution: ConflictResolution }
    output: SftpMoveResponse
  }
  'sftp.uploadBegin': {
    input: {
      sessionId: string
      name: string
      destDir: string
      overwrite: boolean
      size: number
      lastModified: number
    }
    output: SftpUploadBeginResponse
  }
  'sftp.uploadCheckpoint': {
    input: { taskId: string }
    output: {
      size: number
      last_modified?: number | null
    }
  }
  'sftp.resumeUpload': {
    input: { taskId: string; size: number; lastModified: number; restart: boolean }
    output: SftpUploadBeginResponse
  }
  'sftp.pauseTransfer': { input: { taskId: string }; output: TransferTask }
  'sftp.resumeTransfer': { input: { taskId: string }; output: TransferTask }
  'sftp.retryTransfer': { input: { taskId: string; restart: boolean }; output: TransferTask }

  'sftp.download': { input: { sessionId: string; paths: string[] }; output: SftpDownloadResponse }
  'sftp.exportDownload': { input: { taskId: string }; output: string | null }
  'sftp.listTransfers': {
    input: { sessionId: string } | { sessionId: string | undefined; status: string | undefined }
    output: TransferTask[]
  }
  'sftp.downloadClose': { input: { taskId: string }; output: void }
  'sftp.downloadChunk': { input: { taskId: string; offset: number; maxBytes: number }; output: Uint8Array }
  'sftp.cancelTransfer': { input: { taskId: string }; output: TransferTask }
  'sftp.clearCompletedTransfers': { input: void; output: void }
  'sftp.uploadChunk': {
    input: { uploadId: string; data: Uint8Array<ArrayBufferLike>; sequence: number }
    output: void
  }
  'sftp.uploadFinish': { input: { uploadId: string }; output: SftpUploadResponse }
}

export const reservedOperations = [
  'account.login',
  'account.logout',
  'account.me',
  'account.register',
  'account.requestPasswordReset',
  'account.resetPassword',
  'account.sendVerificationEmail',
  'account.setSyncEnabled',
  'account.status',
  'account.verifyEmail',
  'backup.applyRestore',
  'backup.backupNow',
  'backup.cloudVersions',
  'backup.createProvider',
  'backup.deleteProvider',
  'backup.deleteVersion',
  'backup.events',
  'backup.export',
  'backup.getSettings',
  'backup.import',
  'backup.oauthUrl',
  'backup.pickFile',
  'backup.preview',
  'backup.previewCloud',
  'backup.previewLegacyAccount',
  'backup.previewSafety',
  'backup.previewVersion',
  'backup.push',
  'backup.restoreVersion',
  'backup.revealPassword',
  'backup.safetyVersions',
  'backup.status',
  'backup.submitLatest',
  'backup.targets',
  'backup.testProvider',
  'backup.updateProvider',
  'backup.updateSettings',
  'backup.versions',
  'document.exportText',
  'document.pick',
  'document.readText',
  'document.release',
  'group.create',
  'group.delete',
  'group.list',
  'group.update',
  'history.delete',
  'history.list',
  'history.record',
  'localState.read',
  'localState.write',
  'profile.confirmHostKey',
  'profile.create',
  'profile.delete',
  'profile.get',
  'profile.list',
  'profile.testExisting',
  'profile.testNew',
  'profile.update',
  'serverDetail.getInfo',
  'serverDetail.getMetrics',
  'session.attach',
  'session.authRespond',
  'session.close',
  'session.complete',
  'session.confirmHostKey',
  'session.create',
  'session.decide',
  'session.input',
  'session.list',
  'session.ping',
  'session.reconnect',
  'session.resize',
  'session.subscribe',
  'session.unsubscribe',
  'sftp.cancelTransfer',
  'sftp.clearCompletedTransfers',
  'sftp.closeSession',
  'sftp.createSession',
  'sftp.delete',
  'sftp.download',
  'sftp.downloadChunk',
  'sftp.downloadClose',
  'sftp.exportDownload',
  'sftp.getSession',
  'sftp.hostKeyDecide',
  'sftp.list',
  'sftp.listSessions',
  'sftp.listTransfers',
  'sftp.mkdir',
  'sftp.move',
  'sftp.pauseTransfer',
  'sftp.readFile',
  'sftp.reconnectSession',
  'sftp.rename',
  'sftp.resumeTransfer',
  'sftp.resumeUpload',
  'sftp.retryTransfer',
  'sftp.stat',
  'sftp.transfer',
  'sftp.tree',
  'sftp.uploadBegin',
  'sftp.uploadCheckpoint',
  'sftp.uploadChunk',
  'sftp.uploadFinish',
  'sftp.writeFile',
  'snippet.create',
  'snippet.delete',
  'snippet.list',
  'snippet.update',
  'sync.bootstrap',
  'sync.changePassword',
  'sync.conflicts',
  'sync.now',
  'sync.preview',
  'sync.resolveConflict',
  'sync.status',
  'sync.unlock',
  'tunnel.delete',
  'tunnel.list',
  'tunnel.save',
  'tunnel.start',
  'tunnel.statuses',
  'tunnel.stop',
  'vault.create',
  'vault.delete',
  'vault.generateKeyPair',
  'vault.get',
  'vault.list',
  'vault.references',
  'vault.reveal',
  'vault.update',
] as const
