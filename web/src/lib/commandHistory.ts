import type { Terminal } from '@xterm/xterm'
import type { HistoryEntry } from '@/api/localState'
import { useHistoryStore } from '@/store/history'
import { extractInputFromLine, type BufferState } from './completionBuffer'

const LEGACY_KEY = 'eizhu-cmd-history'

/** 仅接受正常缓冲区中能核对回显的单行输入；记录不表示执行成功。 */
export function reliableHistoryCommand(buffer: BufferState, terminal: Terminal | null): string | null {
  if (!terminal || terminal.buffer.active.type !== 'normal' || buffer.stale || /^\s/.test(buffer.text)
      || !buffer.text.trim() || Array.from(buffer.text).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null
  const active = terminal.buffer.active
  const row = active.baseY + active.cursorY
  let start = row
  while (start > 0 && active.getLine(start)?.isWrapped) start--
  let line = ''
  while (start <= row) line += active.getLine(start++)?.translateToString(true) ?? ''
  const echoed = extractInputFromLine(line)
  if (echoed.promptEnd <= 0 || echoed.text !== buffer.text.trimEnd()) return null
  return buffer.text.trimEnd()
}

export function recordCommand(profileId: string, tabId: string, command: string, cwd?: string): Promise<void> {
  return useHistoryStore.getState().record(profileId, tabId, command, cwd)
}

export function queryHistory(profileId: string, pathPrefix: string, _currentCwd?: string, limit = 6) {
  const prefix = pathPrefix.trim().replace(/^~\//, '/').replace(/\/+$/, '')
  if (!prefix) return []
  const matches = (useHistoryStore.getState().entries[profileId] ?? []).filter((entry) => {
    const cwd = entry.cwd.replace(/\/+$/, '')
    return entry.command.includes(prefix) || (cwd && (cwd === prefix || cwd.startsWith(prefix + '/') || prefix.startsWith(cwd + '/')))
  }).sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
  const seen = new Set<string>()
  return matches.filter((entry) => { if (seen.has(entry.command)) return false; seen.add(entry.command); return true })
    .slice(0, limit).map(({ command, count }) => ({ command, count }))
}

/** 旧数据没有账号/服务器身份，只有显式选择归属后才能导入。 */
export function readLegacyHistory(): HistoryEntry[] {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '{}').entries
    if (!Array.isArray(entries)) return []
    return entries.filter((e) => e && typeof e.command === 'string' && Number.isFinite(e.lastAt)).slice(0, 5000)
      .map((e) => ({ id: '', command: e.command, cwd: typeof e.cwd === 'string' ? e.cwd : '', count: Math.max(1, e.count || 1), lastAt: e.lastAt }))
  } catch { return [] }
}
export function removeLegacyHistory() { localStorage.removeItem(LEGACY_KEY) }
