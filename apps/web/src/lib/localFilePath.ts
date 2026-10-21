/** The file domain uses slash paths; Windows drives and UNC shares have explicit roots. */
export function localFilePath(path: string): string {
  if (/^[a-z]:[\\/]/i.test(path)) return '/' + path.replace(/\\/g, '/')
  if (path.startsWith('\\\\')) return '/UNC/' + path.slice(2).replace(/\\/g, '/')
  return path
}
