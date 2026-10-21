import type { TunnelStatus } from '@/api/tunnel'
export function mergeStatuses(current: Record<string, TunnelStatus>, incoming: TunnelStatus[]) {
  const next = { ...current }
  for (const status of incoming) if (!next[status.id] || next[status.id].generation < status.generation || (next[status.id].generation === status.generation && next[status.id].revision <= status.revision)) next[status.id] = status
  return next
}
