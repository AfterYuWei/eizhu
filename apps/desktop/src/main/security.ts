import { resolve, relative, isAbsolute, sep } from 'node:path'
export const APP_ORIGIN = 'eizhu://app'
export function assetPath(root: string, url: string): string | null {
  const parsed = new URL(url)
  if (parsed.origin !== 'null' && parsed.origin !== APP_ORIGIN) return null
  if (parsed.protocol !== 'eizhu:' || parsed.hostname !== 'app') return null
  const decoded = decodeURIComponent(parsed.pathname)
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  const path = resolve(root, `.${decoded}`)
  const rel = relative(root, path)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return path
}
export function isTrustedPage(url: string, devUrl?: string): boolean {
  try {
    const page = new URL(url)
    if (devUrl) return page.origin === new URL(devUrl).origin
    return page.protocol === 'eizhu:' && page.hostname === 'app'
  } catch {
    return false
  }
}
