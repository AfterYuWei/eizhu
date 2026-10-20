import type { Profile } from './profile.ts'
import type { Group } from './group.ts'
import type { VaultItem, VaultType } from './vault.ts'

export interface ServerSessionResponse {
  session_id: string
  status: string
  home_dir?: string // User's home directory
}

export interface ServerInfo {
  hostname: string
  os: string
  icon: string
  kernel: string
  arch: string
  uptime: string
  load_avg: string
  load_avg_detail: string
  cpus: number
  cpu_mhz: number // CPU frequency in MHz
}

export interface NetIfStat {
  name: string
  rx: number
  tx: number
}

export interface ProcMem {
  name: string
  percent: number
  rss: number
}

export interface ServerMetrics {
  cpu: number
  cpu_detail: number[]
  mem_used: number
  mem_total: number
  mem_percent: number
  mem_detail: ProcMem[]
  disk_used: number
  disk_total: number
  disk_percent: number
  cpu_mhz: number // CPU frequency in MHz (dynamic, real-time)
  net_rx: number
  net_tx: number
  net_detail: NetIfStat[]
}

export interface HistoryEntry {
  id: string
  command: string
  cwd: string
  count: number
  lastAt: number
}

export interface HistorySettings {
  enabled: boolean
  maxEntries: number
  retentionDays: number
}

export type LocalStateKey = 'history_settings' | 'terminal_layout' | 'shortcuts'

export interface VaultListParams {
  type?: VaultType
  q?: string
}

export interface APIError extends Error {
  error: { code: string; message: string }
  references?: unknown
}

export type TunnelKind = 'local' | 'remote' | 'dynamic'

export interface TunnelConfig {
  id: string
  name: string
  profile_id: string
  kind: TunnelKind
  bind_host: string
  bind_port: number
  target_host: string
  target_port: number
}

export interface TunnelStatus {
  id: string
  status: 'stopped' | 'connecting' | 'running' | 'reconnecting' | 'failed'
  generation: number
  revision: number
  bound_port: number | null
  active_connections: number
  retry_attempt: number
  error_code: string | null
  error_message: string | null
}

export type CredentialMode = 'none' | 'encrypted' | 'plain'

export type ImportStrategy = 'skip' | 'overwrite' | 'regenerate'

export interface BackupStats {
  groups: number
  vault: number
  profiles: number
  snippets: number
}

export interface BackupPreview {
  credential_mode: CredentialMode
  exported_at: string
  stats: BackupStats
  conflicts: BackupStats
}

export interface BackupImportResult {
  imported: BackupStats
  skipped: BackupStats
  snapshot?: {
    groups: Group[]
    profiles: Profile[]
    vault: VaultItem[]
  }
  snapshot_error?: string
}

export interface BackupSource {
  name: string
  path: string
}

export interface DocumentDescriptor {
  reference: string
  name: string
  size: number
}

export interface SftpSessionInfo {
  host_key_request_id?:string
  auth_request?:import('./sessionMessage.ts').AuthenticationRequestPayload
  id: string
  profile_id: string
  status: string
  error?: string
  home_dir?: string // User's home directory
  created_at: string
  host_key_fingerprint?: string
  known_host_key_fingerprint?: string
}
