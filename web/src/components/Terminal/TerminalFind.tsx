import { useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function TerminalFind({ getTerminal, onClose }: { getTerminal: () => Terminal | null; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [summary, setSummary] = useState('')
  const cursor = useRef(-1)
  const search = (text: string, forward = true) => {
    setQuery(text)
    const terminal = getTerminal()
    if (!terminal || !text) { setSummary(''); return }
    const matches: { row: number; column: number; length: number }[] = []
    const buffer = terminal.buffer.active
    for (let row = 0; row < buffer.length; row++) {
      const line = buffer.getLine(row)
      if (!line) continue
      const chars: string[] = []
      const columns: number[] = []
      for (let col = 0; col < line.length; col++) {
        const cell = line.getCell(col)
        if (!cell || cell.getWidth() === 0) continue
        const value = cell.getChars() || ' '
        for (const unit of value.split('')) { chars.push(unit); columns.push(col) }
      }
      const haystack = chars.join('').toLowerCase()
      const needle = text.toLowerCase()
      for (let index = haystack.indexOf(needle); index >= 0; index = haystack.indexOf(needle, index + Math.max(1, needle.length))) {
        const column = columns[index]
        const last = columns[index + needle.length - 1]
        matches.push({ row, column, length: last - column + (line.getCell(last)?.getWidth() ?? 1) })
      }
    }
    if (!matches.length) { setSummary('无匹配'); return }
    cursor.current = (cursor.current + (forward ? 1 : -1) + matches.length) % matches.length
    const match = matches[cursor.current]
    terminal.select(match.column, match.row, match.length)
    terminal.scrollToLine(match.row)
    setSummary(`${cursor.current + 1}/${matches.length}`)
  }
  return <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-lg border bg-popover p-2 shadow-lg" role="search" aria-label="查找终端内容">
    <Input autoFocus className="h-8 w-52" aria-label="查找内容" value={query} onChange={(e) => { cursor.current = -1; search(e.target.value) }} onKeyDown={(e) => {
      e.stopPropagation()
      if (e.key === 'Enter') { e.preventDefault(); search(query, !e.shiftKey) }
      if (e.key === 'Escape') onClose()
    }} /><span className="text-xs text-muted-foreground">{summary}</span>
    <Button variant="ghost" size="sm" onClick={() => search(query, false)}>上一个</Button>
    <Button variant="ghost" size="sm" onClick={() => search(query)}>下一个</Button>
    <Button variant="ghost" size="sm" aria-label="关闭查找" onClick={onClose}>×</Button>
  </div>
}
