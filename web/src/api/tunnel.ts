import { invokeCommand } from './tauri'
export type TunnelKind = 'local' | 'remote'
export interface TunnelConfig { id: string; name: string; profile_id: string; kind: TunnelKind; bind_host: string; bind_port: number; target_host: string; target_port: number }
export interface TunnelStatus { id: string; status: 'stopped' | 'connecting' | 'running' | 'reconnecting' | 'failed'; generation: number; revision: number; bound_port: number | null; active_connections: number; retry_attempt: number; error_code: string | null; error_message: string | null }
export const tunnelApi = {
  list: () => invokeCommand<TunnelConfig[]>('tunnel_list'),
  statuses: () => invokeCommand<TunnelStatus[]>('tunnel_statuses'),
  save: (config: TunnelConfig) => invokeCommand<TunnelConfig>('tunnel_save', { config }),
  remove: (id: string) => invokeCommand<void>('tunnel_delete', { id }),
  start: (id: string) => invokeCommand<TunnelStatus>('tunnel_start', { id }),
  stop: (id: string) => invokeCommand<void>('tunnel_stop', { id }),
}
