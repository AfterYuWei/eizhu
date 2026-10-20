import { bridge } from '@/lib/bridge'
import type { LocalStateKey } from '@eizhu/contracts/models/api'

export type { HistoryEntry } from '@eizhu/contracts/models/api'
export type { HistorySettings } from '@eizhu/contracts/models/api'
export type { LocalStateKey } from '@eizhu/contracts/models/api'
export const localStateApi = {
  read: <T>(key: LocalStateKey) => bridge().localState.read({ key }) as Promise<T | null>,
  write: (key: LocalStateKey, value: unknown) => bridge().localState.write({ key, value }),
  history: (profileId: string) => bridge().history.list({ profileId }),
  record: (profileId: string, command: string, cwd = '') =>
    bridge().history.record({ profileId, command, cwd }),
  remove: (profileId?: string, id?: string) => bridge().history.delete({ profileId, id }),
}
