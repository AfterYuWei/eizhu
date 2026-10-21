import { bridge } from '@/lib/bridge'
import type { TunnelConfig } from '@eizhu/contracts/models/api'
export type { TunnelKind } from '@eizhu/contracts/models/api'
export type { TunnelConfig } from '@eizhu/contracts/models/api'
export type { TunnelStatus } from '@eizhu/contracts/models/api'
export const tunnelApi = {
  list: () => bridge().tunnel.list(),
  statuses: () => bridge().tunnel.statuses(),
  save: (config: TunnelConfig) => bridge().tunnel.save({ config }),
  remove: (id: string) => bridge().tunnel.delete({ id }),
  start: (id: string) => bridge().tunnel.start({ id }),
  stop: (id: string) => bridge().tunnel.stop({ id }),
}
