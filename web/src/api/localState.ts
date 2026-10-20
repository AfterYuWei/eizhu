import { invokeCommand } from './tauri'

export interface HistoryEntry { id: string; command: string; cwd: string; count: number; lastAt: number }
export interface HistorySettings { enabled: boolean; maxEntries: number; retentionDays: number }
export type LocalStateKey = 'history_settings' | 'terminal_layout' | 'shortcuts'
export const localStateApi = {
  read: <T>(key: LocalStateKey) => invokeCommand<T | null>('local_state_read', { key }),
  write: (key: LocalStateKey, value: unknown) => invokeCommand<void>('local_state_write', { key, value }),
  history: (profileId: string) => invokeCommand<HistoryEntry[]>('history_list', { profileId }),
  record: (profileId: string, command: string, cwd = '') => invokeCommand<void>('history_record', { profileId, command, cwd }),
  remove: (profileId?: string, id?: string) => invokeCommand<void>('history_delete', { profileId, id }),
  import: (profileId: string, entries: HistoryEntry[]) => invokeCommand<number>('history_import', { profileId, entries }),
}
