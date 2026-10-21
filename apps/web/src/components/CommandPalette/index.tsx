import { useState,useRef,useEffect,useMemo } from 'react'
import { Search,Server,Command,KeyRound } from 'lucide-react'
import { useProfileStore } from '@/store/profile'
import { useWorkspaceViewStore } from '@/store/workspaceView'
import { useSessionStore } from '@/store/session'
import { useVaultStore } from '@/store/vault'
import { vaultApi } from '@/api/vault'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { desktopActions,runDesktopAction,focusActiveTerminal } from '@/lib/desktopActions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogTitle } from '@/components/ui/dialog'
import type { VaultItem } from '@/types/vault'

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profiles = useProfileStore((s) => s.profiles)
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [vaults, setVaults] = useState<VaultItem[]>([])
  const [searching, setSearching] = useState(false)
  const [vaultError, setVaultError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const executing = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const items = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return [
      ...profiles.filter((p) => `${p.name} ${p.username} ${p.host} ${p.port}`.toLowerCase().includes(needle)).map((profile) => ({
        id: profile.id, type: 'server' as const, label: profile.name,
        detail: `${profile.username}@${profile.host}:${profile.port}`, shortcut: '', run: () => {
          const store = useSessionStore.getState()
          const existing = store.tabs.find((t) => t.profileId === profile.id)
          if (existing) store.setActiveTab(existing.id)
          else {
            const draft = store.tabs.find((t) => t.id === store.activeTabId && !t.profileId && !t.sessionId)
            void store.openTab(profile.id, profile.name, profile.host, profile.port, profile.username, draft?.id)
          }
        },
      })),
      ...vaults.map((item) => ({ id: item.id, type: 'vault' as const, label: item.name,
        detail: item.type === 'private_key' ? '私钥' : `密码 · ${item.username || '未设置用户名'}`, shortcut: '', run: () => {
          useVaultStore.setState({ filterType: 'all', searchQuery: item.name, focusedItemId: item.id })
          useWorkspaceViewStore.getState().openVault()
          void useVaultStore.getState().fetchList()
        },
      })),
      ...desktopActions.filter((a) => a.id !== 'palette' && a.label.toLowerCase().includes(needle)).map((a) => ({
        id: a.id, type: 'action' as const, label: a.label, detail: '', shortcut: `Ctrl/Cmd+Shift+${a.key.toUpperCase()}`, run: () => runDesktopAction(a.id),
      })),
    ]
  }, [profiles, query, vaults])
  const selected = Math.max(0, items.findIndex((item) => `${item.type}:${item.id}` === selectedKey))

  useEffect(() => {
    if (open) { setQuery(''); setSelectedKey(null); executing.current = false }
  }, [open])
  useEffect(() => {
    if (!open) { setVaults([]); return }
    const generation = workspaceGeneration()
    let active = true
    setVaults([]); setVaultError(false); setSearching(true)
    void vaultApi.list({ q: query.trim() || undefined }).then((items) => {
      if (active && generation === workspaceGeneration()) setVaults(items ?? [])
    }).catch(() => {
      if (active && generation === workspaceGeneration()) setVaultError(true)
    }).finally(() => {
      if (active && generation === workspaceGeneration()) setSearching(false)
    })
    return () => { active = false }
  }, [query, open])
  useEffect(() => { setSelectedKey(null) }, [query])
  useEffect(() => {
    resultsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])
  const execute = (index: number) => {
    const item = items[index]
    if (!item) return
    executing.current = true
    onClose()
    item.run()
  }
  const groupLabels = { server: '服务器', vault: '密钥', action: '操作命令' }
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
    <DialogContent showCloseButton={false} className="pal shell-palette top-[min(18vh,160px)] max-w-[640px] translate-y-0 gap-0 p-0"
      onOpenAutoFocus={(e) => { e.preventDefault(); returnFocus.current = document.activeElement as HTMLElement | null; inputRef.current?.focus() }}
      onCloseAutoFocus={(e) => {
        e.preventDefault()
        if (executing.current) return
        const active = useSessionStore.getState().tabs.find((tab) => tab.id === useSessionStore.getState().activeTabId)
        if (useWorkspaceViewStore.getState().activePage === 'terminal' && active?.profileId) focusActiveTerminal()
        else if (returnFocus.current?.isConnected) returnFocus.current.focus()
      }}>
      <DialogTitle className="sr-only">搜索服务器、密钥或命令</DialogTitle>
      <div className="pal-inp-wrap"><Search size={17} /><Input ref={inputRef} className="pal-inp focus-visible:ring-0" placeholder="搜索服务器、密钥或命令…" value={query}
        role="combobox" aria-label="搜索服务器、密钥或命令" aria-expanded="true" aria-controls="global-search-results" aria-autocomplete="list"
        aria-activedescendant={items[selected] ? `global-search-${selected}` : undefined}
        onChange={(e) => { setQuery(e.target.value); setSelectedKey(null) }} onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const item = items[Math.max(0, Math.min(items.length - 1, selected + (e.key === 'ArrowDown' ? 1 : -1)))]
            setSelectedKey(item ? `${item.type}:${item.id}` : null)
          }
          if (e.key === 'Enter') { e.preventDefault(); execute(Math.min(selected, items.length - 1)) }
        }} /></div>
      <div className="pal-results" ref={resultsRef} id="global-search-results" role="listbox" aria-label="全局搜索结果">
        {(['server', 'vault', 'action'] as const).map((type) => {
          const group = items.map((item, index) => ({ item, index })).filter(({ item }) => item.type === type)
          if (!group.length) return null
          return <div key={type} role="group" aria-label={groupLabels[type]}>
            <div className="shell-search-group-title">{groupLabels[type]}</div>
            {group.map(({ item, index }) => <Button key={`${item.type}:${item.id}`} id={`global-search-${index}`} variant="ghost"
              className={`pal-item ${index === selected ? 'sel' : ''}`} role="option" aria-selected={index === selected}
              onMouseEnter={() => setSelectedKey(`${item.type}:${item.id}`)} onClick={() => execute(index)}>
              <span className="pal-item-icon">{type === 'server' ? <Server size={15} /> : type === 'vault' ? <KeyRound size={15} /> : <Command size={15} />}</span>
              <span className="pal-item-label">{item.label}{item.detail && <small>{item.detail}</small>}</span><span className="pal-item-kbd">{item.shortcut}</span>
            </Button>)}
          </div>
        })}
        {searching && <div className="pal-empty" role="status">正在搜索密钥…</div>}
        {vaultError && <div className="pal-empty" role="status">密钥搜索暂不可用，请稍后重试</div>}
        {!items.length && !searching && <div className="pal-empty">没有匹配的服务器、密钥或命令</div>}
      </div>
      <div className="shell-search-hint"><span>↑ ↓ 选择</span><span>↵ 打开</span><span>Esc 关闭</span></div>
    </DialogContent>
  </Dialog>
}
