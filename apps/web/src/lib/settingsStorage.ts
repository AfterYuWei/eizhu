import { bridge, desktopBootstrap } from './bridge'
import type { StateStorage } from 'zustand/middleware'
const values = new Map<string, string>()
export function initializeSettingsStorage(): void {
  for (const [key, value] of Object.entries(desktopBootstrap()?.settings ?? {}))
    if (value !== undefined) values.set(key, value)
  if (window.eizhu)
    bridge().events.on('eizhu-settings-changed', ({ key, value }) => {
      if (value === null) values.delete(key)
      else values.set(key, value)
      window.dispatchEvent(new CustomEvent('eizhu:settings-updated', { detail: key }))
    })
}
function supportedKey(key: string): 'eizhu-settings' | 'eizhu-desktop-shell' {
  if (key !== 'eizhu-settings' && key !== 'eizhu-desktop-shell') throw new Error('Unsupported preference key')
  return key
}
/** Synchronous hydrated reads before first paint; all persistent writes belong to Node's DB worker. */
export const settingsStorage: StateStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => {
    values.set(key, value)
    if (!window.eizhu) return
    return bridge().settings.write({ key: supportedKey(key), value })
  },
  removeItem: (key) => {
    values.delete(key)
    if (!window.eizhu) return
    return bridge().settings.write({ key: supportedKey(key), value: null })
  },
}
