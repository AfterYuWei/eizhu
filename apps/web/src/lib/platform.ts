import { initializeBridge, desktopBootstrap } from './bridge'
import type { PlatformCapabilities as DesktopCapabilities } from '@eizhu/contracts'
export type PlatformCapabilities = Omit<DesktopCapabilities, 'runtime' | 'maxConcurrentTransfers'> & {
  runtime: 'desktop' | 'browser'
  maxConcurrentTransfers: number
}
const browserCapabilities: PlatformCapabilities = {
  platform: 'unknown',
  runtime: 'browser',
  windowControls: false,
  appUpdates: false,
  dragOut: false,
  nativeFilePaths: false,
  documentPicker: false,
  secureKeyStore: false,
  maxConcurrentTransfers: 5,
}
export async function initializePlatform(): Promise<PlatformCapabilities> {
  await initializeBridge()
  return getPlatformCapabilities()
}
export function getPlatformCapabilities(): PlatformCapabilities {
  return desktopBootstrap()?.platform ?? browserCapabilities
}
export function isDesktopRuntime(): boolean {
  return getPlatformCapabilities().runtime === 'desktop'
}
