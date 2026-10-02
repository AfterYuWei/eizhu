import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, Server, Command } from 'lucide-react'
import { useProfileStore } from '@/store/profile'
import { useSessionStore } from '@/store/session'
import { desktopActions, runDesktopAction, focusActiveTerminal } from '@/lib/desktopActions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profiles = useProfileStore((s) => s.profiles)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const executing = useRef(false)
  const items = useMemo(() => [
    ...profiles.map((profile) => ({ id: profile.id, type: 'server', label: `${profile.name} — ${profile.username}@${profile.host}:${profile.port}`, shortcut: '', run: () => {
      const store = useSessionStore.getState()
      const existing = store.tabs.find((t) => t.kind === 'terminal' && t.profileId === profile.id)
      if (existing) store.setActiveTab(existing.id)
      else void store.openTab(profile.id, profile.name, profile.host, profile.port, profile.username)
    } })),
    ...desktopActions.filter((a) => a.id !== 'palette').map((a) => ({ id: a.id, type: 'action', label: a.label, shortcut: `Ctrl/Cmd+Shift+${a.key.toUpperCase()}`, run: () => runDesktopAction(a.id) })),
  ].filter((item) => item.label.toLowerCase().includes(query.toLowerCase())), [profiles, query])
  useEffect(() => {
    if (open) { setQuery(''); setSelected(0); executing.current = false }
  }, [open])
  const execute = (index: number) => {
    const item = items[index]
    if (!item) return
    executing.current = true
    onClose(); item.run()
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
    <DialogContent showCloseButton={false} className="pal top-[min(18vh,160px)] max-w-[560px] translate-y-0 gap-0 p-0"
      onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus() }}
      onCloseAutoFocus={(e) => { e.preventDefault(); if (!executing.current) focusActiveTerminal() }}>
      <DialogTitle className="sr-only">命令面板</DialogTitle>
      <div className="pal-inp-wrap"><Search size={15} /><Input ref={inputRef} className="pal-inp focus-visible:ring-0" placeholder="搜索命令或服务器…" value={query}
        onChange={(e) => { setQuery(e.target.value); setSelected(0) }} onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))) }
          if (e.key === 'Enter') { e.preventDefault(); execute(selected) }
        }} /></div>
      <div className="pal-results" role="listbox" aria-label="命令和服务器">
        {items.length === 0 && <div className="pal-empty">没有匹配的命令或服务器</div>}
        {items.map((item, i) => <Button key={`${item.type}:${item.id}`} variant="ghost" className={`pal-item ${i === selected ? 'sel' : ''}`} role="option" aria-selected={i === selected}
          onMouseEnter={() => setSelected(i)} onClick={() => execute(i)}>
          <span className="pal-item-icon">{item.type === 'server' ? <Server size={14} /> : <Command size={14} />}</span>
          <span className="pal-item-label">{item.label}</span><span className="pal-item-kbd">{item.shortcut}</span>
        </Button>)}
      </div>
    </DialogContent>
  </Dialog>
}
