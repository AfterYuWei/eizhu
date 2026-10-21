export const DEFAULT_SERVER_ICON = 'server'
export const AUTO_SERVER_ICON_PREFIX = 'os-'

/** Default and previously detected icons may be refreshed after a later connection. */
export function isAutoManagedServerIcon(icon?: string): boolean {
  return !icon || icon === DEFAULT_SERVER_ICON || icon.startsWith(AUTO_SERVER_ICON_PREFIX)
}
