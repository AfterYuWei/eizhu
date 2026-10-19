import { useEffect, useRef } from 'react'
import { ChevronDown, FolderUp, KeyRound, Plus, SquareTerminal, X } from 'lucide-react'
import { useSessionStore, type SessionTab } from '@/store/session'
import { useProfileStore } from '@/store/profile'
import { runDesktopAction } from '@/lib/desktopActions'
import { Button } from '@/components/ui/button'
import { ShellIconButton } from './ShellControls'

const baseName = (tab: SessionTab) => tab.kind === 'vault' ? '密钥管理' : tab.kind === 'sftp' ? 'SFTP' : tab.profileName

export function OpenItems({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { tabs, activeTabId, setActiveTab } = useSessionStore()
  const profiles = useProfileStore((s) => s.profiles)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [activeTabId])
  return <section className="shell-open-items" aria-label="已打开">
    <div className="shell-section-heading">
      <Button variant="ghost" className="shell-section-toggle" aria-expanded={!collapsed} onClick={onToggle}>
        <ChevronDown className={collapsed ? 'is-collapsed' : ''} size={12} /><span>已打开</span><span className="shell-count">{tabs.length}</span>
      </Button>
      <ShellIconButton label="新建连接 (Ctrl/Cmd+Shift+T)" onClick={() => runDesktopAction('new')}><Plus size={15} /></ShellIconButton>
    </div>
    <div className="shell-open-list" hidden={collapsed} inert={collapsed} ref={list}>
      {!tabs.length && <p className="shell-list-empty">暂无打开的会话</p>}
      {tabs.map((tab, index) => {
        const name = baseName(tab)
        const similar = tabs.filter((item) => item.kind === tab.kind && baseName(item) === name)
        const ordinal = tabs.slice(0, index + 1).filter((item) => item.kind === tab.kind && baseName(item) === name).length
        const profile = profiles.find((p) => p.id === tab.profileId)
        const label = `${name}${tab.kind === 'sftp' && profile ? ` · ${profile.name}` : ''}${similar.length > 1 ? ` (${ordinal})` : ''}`
        const address = tab.host ? `${tab.username || 'root'}@${tab.host}:${tab.port || 22}` : profile ? `${profile.username}@${profile.host}:${profile.port}` : ''
        const Icon = tab.kind === 'vault' ? KeyRound : tab.kind === 'sftp' ? FolderUp : SquareTerminal
        return <div className={`shell-open-item ${activeTabId === tab.id ? 'is-active' : ''}`} key={tab.id}>
          <Button variant="ghost" className="shell-open-select" data-open-item aria-current={activeTabId === tab.id ? 'page' : undefined}
            title={[label, address, tab.cwd, tab.errorMessage].filter(Boolean).join(' · ')} onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
              event.preventDefault()
              const next = tabs[(index + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length]
              setActiveTab(next.id)
              const buttons = list.current?.querySelectorAll<HTMLButtonElement>('[data-open-item]')
              buttons?.[tabs.indexOf(next)]?.focus()
            }}>
            <Icon size={15} /><span className="shell-open-name">{label}</span>
            {tab.kind === 'terminal' && <span className={`shell-connection-dot is-${tab.status}`} aria-label={tab.status === 'connected' ? '已连接' : tab.status === 'connecting' || tab.status === 'reconnecting' ? '连接中' : '已断开'} />}
          </Button>
          <ShellIconButton label={`关闭 ${label}`} className="shell-open-close" onClick={() => runDesktopAction('close', tab.id)}><X size={13} /></ShellIconButton>
        </div>
      })}
    </div>
  </section>
}
