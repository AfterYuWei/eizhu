import { bridge, desktopBootstrap } from './bridge'
import type { UpdateCandidate, UpdateProgress } from '@eizhu/contracts'
import type { UpdateChannel } from '@/store/settings'
export type { UpdateChannel }
export const buildChannel: UpdateChannel =
  import.meta.env.VITE_EIZHU_CHANNEL === 'test' || import.meta.env.DEV ? 'test' : 'stable'
export function isTestBuild(): boolean {
  return buildChannel === 'test'
}
export async function appVersion(): Promise<string> {
  return desktopBootstrap()?.version ?? import.meta.env.VITE_EIZHU_VERSION ?? ''
}
export interface UpdateCheckResult {
  available: boolean
  version: string
  newVersion: string
  notes: string
}
export type UpdateDownloadProgress = Omit<UpdateProgress, 'token'>
let candidate: UpdateCandidate | null = null
export async function checkForUpdates(channel: UpdateChannel = buildChannel): Promise<UpdateCheckResult> {
  candidate = null
  candidate = (await bridge().update.check({ channel })).candidate
  return {
    available: Boolean(candidate),
    version: await appVersion(),
    newVersion: candidate?.version ?? '',
    notes: candidate?.notes ?? '',
  }
}
export async function downloadAndInstallUpdate(
  channel: UpdateChannel = buildChannel,
  onProgress?: (progress: UpdateDownloadProgress) => void,
): Promise<void> {
  const selected = candidate
  if (!selected || selected.channel !== channel) throw new Error('更新候选已失效，请重新检查')
  const api = bridge()
  const stop = api.events.on('eizhu-update-progress', (progress) => {
    if (progress.token === selected.token) onProgress?.(progress)
  })
  try {
    await api.update.download({ token: selected.token })
    await api.update.install({ token: selected.token })
  } finally {
    stop()
  }
}
// Checks are user initiated until signed update feeds have completed release acceptance.
export function scheduleSilentUpdateCheck(): void {}
