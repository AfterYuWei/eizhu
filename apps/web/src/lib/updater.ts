import { desktopBootstrap } from './bridge'
import type { UpdateChannel } from '@/store/settings'
export type { UpdateChannel }
export const buildChannel: UpdateChannel = import.meta.env.VITE_EIZHU_CHANNEL === 'test' || import.meta.env.DEV ? 'test' : 'stable'
export function isTestBuild(): boolean { return buildChannel === 'test' }
export async function appVersion(): Promise<string> { return desktopBootstrap()?.version ?? import.meta.env.VITE_EIZHU_VERSION ?? '' }
export interface UpdateCheckResult { available: boolean; version: string; newVersion: string; notes: string }
export interface UpdateDownloadProgress { phase: 'downloading' | 'installing'; downloadedBytes: number; totalBytes: number | null; percent: number | null; bytesPerSecond: number }
export async function checkForUpdates(_channel?: UpdateChannel): Promise<UpdateCheckResult> { throw new Error('Electron 独立更新源将在阶段 6 开放；首个版本需手动安装') }
export async function downloadAndInstallUpdate(_channel?: UpdateChannel, _onProgress?: (progress: UpdateDownloadProgress) => void): Promise<void> { throw new Error('更新尚未开放') }
export function scheduleSilentUpdateCheck(): void { /* Enabled with the independent Electron feed in stage 6. */ }
