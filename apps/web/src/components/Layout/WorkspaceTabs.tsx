import { useEffect, useLayoutEffect, useRef } from 'react'
import { CircleAlert, LoaderCircle, Plus, SquareTerminal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSessionStore, type SessionTab } from '@/store/session'
import { useWorkspaceViewStore } from '@/store/workspaceView'
import { useProfileStore } from '@/store/profile'
import { focusActiveTerminal, runDesktopAction } from '@/lib/desktopActions'
import { cn } from '@/lib/utils'
import { resolveServerIcon } from '@/lib/serverIcons'
import { ShellIconButton } from './ShellControls'

function connectionStatus(tab: SessionTab): string {
  if (!tab.profileId) return ''
  switch (tab.status) {
    case 'connected': return tab.latency != null ? `${tab.latency} ms` : '已连接'
    case 'connecting': return '连接中…'
    case 'reconnecting': return `重连中${tab.reconnectAttempt ? ` (${tab.reconnectAttempt})` : ''}`
    case 'error': return '连接失败'
    case 'disconnected': return '已断开'
  }
}

function ConnectionIndicator({ tab }: { tab: SessionTab }) {
  if (tab.status === 'error') return <CircleAlert className="shell-connection-error" size={13} />
  if (tab.status === 'connecting' || tab.status === 'reconnecting') return <LoaderCircle className="shell-connection-pending animate-spin" size={12} />
  const latency = tab.status === 'connected' && tab.latency != null && Number.isFinite(tab.latency) && tab.latency >= 0 ? tab.latency : null
  const quality = latency === null ? null : latency <= 100 ? 'good' : latency <= 300 ? 'fair' : 'slow'
  return <span className={cn('shell-connection-dot', quality && `is-${quality}`)} />
}

export function WorkspaceTabs() {
  const { tabs, activeTabId, setActiveTab } = useSessionStore()
  const activePage = useWorkspaceViewStore((state) => state.activePage)
  const profiles = useProfileStore((state) => state.profiles)
  const scroll = useRef<HTMLDivElement>(null)
  const add = useRef<HTMLButtonElement>(null)
  const focusOnRemoval = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (!focusOnRemoval.current || tabs.some((tab) => tab.id === focusOnRemoval.current)) return
    focusOnRemoval.current = null
    const selected = scroll.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
    ;(selected ?? add.current)?.focus()
  }, [tabs])

  useEffect(() => {
    const host = scroll.current
    if (!host) return
    const reveal = () => host.querySelector('[aria-selected="true"]')?.closest('.shell-tab')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(host)
    // Mouse wheels scroll the tab strip; trackpads retain native horizontal scrolling.
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || host.scrollWidth <= host.clientWidth) return
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientWidth : 1
      host.scrollLeft += event.deltaY * scale
      event.preventDefault()
    }
    host.addEventListener('wheel', wheel, { passive: false })
    return () => { observer.disconnect(); host.removeEventListener('wheel', wheel) }
  }, [activePage, activeTabId, tabs.length])

  return <div className="shell-workspace-tabs">
    <div className="shell-tab-scroll" ref={scroll}>
      <div className="shell-tab-list" role="tablist" aria-label="已打开页面" aria-orientation="horizontal">
        {tabs.map((tab, index) => {
          const name = tab.profileName
          const sameName = (item: SessionTab) => item.profileName === name
          const ordinal = tabs.slice(0, index + 1).filter(sameName).length
          const profile = profiles.find((item) => item.id === tab.profileId)
          const label = `${name}${tabs.filter(sameName).length > 1 ? ` (${ordinal})` : ''}`
          const status = connectionStatus(tab)
          const address = tab.host ? `${tab.username || 'root'}@${tab.host}:${tab.port || 22}` : profile ? `${profile.username}@${profile.host}:${profile.port}` : ''
          const description = [label, address, status, tab.cwd, tab.errorMessage].filter(Boolean).join(' · ')
          const Icon = tab.profileId ? resolveServerIcon(profile?.icon) : SquareTerminal
          const active = activePage === 'terminal' && tab.id === activeTabId
          return <div key={tab.id} role="presentation" className={cn('shell-tab', active && 'is-active')}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" role="tab" className="shell-tab-select"
                  id={`workspace-tab-${tab.id}`} aria-controls={`workspace-panel-${tab.id}`}
                  aria-selected={active} aria-label={[label, status].filter(Boolean).join(' · ')} tabIndex={active || (activePage !== 'terminal' && tab.id === (activeTabId ?? tabs[0]?.id)) ? 0 : -1}
                  onClick={(event) => {
                    setActiveTab(tab.id)
                    if (event.detail > 0) requestAnimationFrame(() => {
                      if (useSessionStore.getState().activeTabId === tab.id) focusActiveTerminal()
                    })
                  }}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return
                    event.preventDefault()
                    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
                    setActiveTab(tabs[nextIndex].id)
                    scroll.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus()
                  }}>
                  <Icon size={16} aria-hidden="true" />
                  <span className="shell-tab-name">{label}</span>
                  {status && <span className="shell-tab-status" aria-hidden="true"><ConnectionIndicator tab={tab} /></span>}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>{description}</TooltipContent>
            </Tooltip>
            <ShellIconButton label={`关闭 ${label}`} className="shell-tab-close" tabIndex={active ? 0 : -1}
              onClick={(event) => {
                if (event.currentTarget.parentElement?.contains(document.activeElement)) focusOnRemoval.current = tab.id
                runDesktopAction('close', tab.id)
              }}><X size={13} /></ShellIconButton>
          </div>
        })}
      </div>
    </div>
    <ShellIconButton ref={add} label="新建连接 (Ctrl/Cmd+Shift+T)" className="shell-tab-add" onClick={() => runDesktopAction('new')}><Plus size={16} /></ShellIconButton>
  </div>
}
