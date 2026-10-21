import { lazy,Suspense,useCallback,useEffect,useRef,useState,type CSSProperties } from 'react'
import { FolderUp,KeyRound,PanelLeft,PanelLeftClose,PanelRight,Plus,Search,SquareTerminal } from 'lucide-react'
import { TunnelDialog,TunnelPrompts } from '@/components/Terminal/TunnelDialog'
import type { SettingsTab } from '@/components/SettingsDialog'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { registerDesktopAction,runDesktopAction,shortcutAction } from '@/lib/desktopActions'
import { DEFAULT_DESKTOP_SIDEBAR_WIDTH,MIN_DESKTOP_SIDEBAR_WIDTH,MAX_DESKTOP_SIDEBAR_WIDTH,DESKTOP_SIDEBAR_INSET } from '@/lib/desktopSidebar'
import { Sidebar } from '@/components/Sidebar'
import { TerminalView } from '@/components/Terminal'
import { TerminalSplitMenu } from '@/components/Terminal/SplitControls'
import { CommandPalette } from '@/components/CommandPalette'
import { Toaster } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { ProfileForm } from '@/components/ProfileForm'
import { useProfileStore } from '@/store/profile'
import { useSessionStore } from '@/store/session'
import { useSidebarDetailStore } from '@/store/sidebarDetail'
import { useTerminalLayoutStore } from '@/store/terminalLayout'
import { useSettingsStore,useResolvedTheme } from '@/store/settings'
import { useDesktopShellStore } from '@/store/desktopShell'
import { useSplitSidebar } from '@/hooks/useSplitSidebar'
import { useSidebarPreview } from '@/hooks/useSidebarPreview'
import { useWindowControls } from '@/hooks/useWindowControls'
import { WindowControls } from '@/components/WindowControls'
import { ShellIconButton } from './ShellControls'
import { SidebarResizeHandle } from './SidebarResizeHandle'
import { AccountMenu } from './AccountMenu'
import { WorkspaceTabs } from './WorkspaceTabs'
import { ConnectionHome } from './ConnectionHome'
import { ServerInspector } from './ServerInspector'
import { WorkspaceActions } from './WorkspaceActions'

const SettingsPage = lazy(() => import('@/components/SettingsDialog').then((m) => ({ default: m.SettingsPage })))
const SnippetDialog = lazy(() => import('@/components/Snippets/SnippetDialog').then((m) => ({ default: m.SnippetDialog })))

export function Layout() {
  const { tabs, activeTabId, openVaultTab } = useSessionStore()
  const { sidebarWidth, setSidebarWidth } = useSettingsStore()
  const theme = useResolvedTheme()
  const splitActive = useTerminalLayoutStore((s) => s.tree?.type === 'split')
  const { collapsed: sidebarHidden, toggle: toggleSidebarVisibility, collapse: collapseSidebar, expand: expandSidebar } = useSplitSidebar(splitActive)
  const [sidebarButtonMotion, setSidebarButtonMotion] = useState(false)
  const resizeSidebar = useCallback((width: number) => {
    setSidebarButtonMotion(false)
    setSidebarWidth(width)
  }, [setSidebarWidth])
  const expandSidebarToDefault = useCallback(() => {
    setSidebarButtonMotion(false)
    setSidebarWidth(DEFAULT_DESKTOP_SIDEBAR_WIDTH)
    expandSidebar()
  }, [setSidebarWidth, expandSidebar])
  const toggleSidebar = useCallback(() => {
    setSidebarButtonMotion(true)
    if (sidebarHidden) setSidebarWidth(DEFAULT_DESKTOP_SIDEBAR_WIDTH)
    toggleSidebarVisibility()
  }, [sidebarHidden, setSidebarWidth, toggleSidebarVisibility])
  const { serversCollapsed, toggleServers, inspectorWidth } = useDesktopShellStore()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [tunnelsOpen, setTunnelsOpen] = useState(false)
  const [snippetsOpen, setSnippetsOpen] = useState(false)
  const [profileFormOpen, setProfileFormOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [workspaceWidth, setWorkspaceWidth] = useState(window.innerWidth)
  const workspace = useRef<HTMLDivElement>(null)
  const sessionView = useRef<HTMLDivElement>(null)
  const settingsReturnFocus = useRef<HTMLElement | null>(null)
  const wasSettingsOpen = useRef(false)
  const knownTabs = useRef(new Set<string>())
  const focusAfterResizeCollapse = useRef(false)
  const sidebar = useRef<HTMLElement>(null)
  const sidebarSpace = useRef<HTMLDivElement>(null)
  const suppressSidebarHover = useRef(false)
  const preview = useSidebarPreview(sidebarHidden, settingsOpen, sidebar)
  const sidebarInteractive = !sidebarHidden || preview.interactive
  const { desktop, mac, showControls, maximized, minimize, toggleMaximize, close } = useWindowControls()
  const visibleSidebarWidth = Math.max(MIN_DESKTOP_SIDEBAR_WIDTH, Math.min(MAX_DESKTOP_SIDEBAR_WIDTH, sidebarWidth))
  const { fetchProfiles, fetchGroups } = useProfileStore()
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const terminal = activeTab?.kind === 'terminal' && Boolean(activeTab.profileId)

  const openSettings = useCallback((tab: SettingsTab) => {
    const focused = document.activeElement
    if (focused instanceof HTMLElement && !focused.closest('.settings-page')) settingsReturnFocus.current = focused
    setSettingsTab(tab)
    setSettingsOpen(true)
  }, [])

  useEffect(() => {
    if (!sidebarHidden) suppressSidebarHover.current = false
    if (sidebarHidden && focusAfterResizeCollapse.current) {
      focusAfterResizeCollapse.current = false
      sessionView.current?.querySelector<HTMLButtonElement>('.shell-fixed-top-controls button')?.focus()
    }
  }, [sidebarHidden])

  useEffect(() => {
    if (!settingsOpen && wasSettingsOpen.current) {
      const previous = settingsReturnFocus.current
      const fallback = sessionView.current?.querySelector<HTMLElement>(sidebarHidden ? '.shell-top-controls button' : '.shell-account')
      const target = previous?.isConnected && previous !== document.body && !previous.closest('[inert]') ? previous : fallback
      target?.focus()
    }
    wasSettingsOpen.current = settingsOpen
  }, [settingsOpen, sidebarHidden])

  useEffect(() => { void fetchProfiles(); void fetchGroups() }, [fetchProfiles, fetchGroups])
  useEffect(() => {
    const measure = () => {
      if (workspace.current) setWorkspaceWidth(workspace.current.clientWidth)
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (workspace.current) observer.observe(workspace.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const live = new Set(tabs.map((tab) => tab.id))
    knownTabs.current.forEach((id) => { if (!live.has(id)) useSidebarDetailStore.getState().clearTab(id) })
    knownTabs.current = live
  }, [tabs])
  useEffect(() => {
    const unregister = [
      registerDesktopAction('tunnels', () => setTunnelsOpen(true)),
      registerDesktopAction('palette', () => setPaletteOpen((v) => !v)),
      registerDesktopAction('sync-settings', () => openSettings('sync')),
      registerDesktopAction('account-settings', () => openSettings('account')),
      registerDesktopAction('snippets', () => setSnippetsOpen(true)),
      registerDesktopAction('sidebar', toggleSidebar),
    ]
    const handler = (event: KeyboardEvent) => {
      const action = shortcutAction(event)
      if (!action || event.defaultPrevented || (document.querySelector('[role="dialog"]') && action !== 'palette')) return
      event.preventDefault()
      event.stopPropagation()
      if (settingsOpen && action !== 'sync-settings' && action !== 'account-settings') return
      runDesktopAction(action)
    }
    document.addEventListener('keydown', handler, true)
    return () => { unregister.forEach((fn) => fn()); document.removeEventListener('keydown', handler, true) }
  }, [toggleSidebar, openSettings, settingsOpen])

  const topControls = <div className="shell-top-controls" data-eizhu-drag-region={desktop || undefined}>
    <ShellIconButton label={`${sidebarHidden ? '展开' : '折叠'}侧栏 (Ctrl/Cmd+Shift+B)`} showTooltip={!sidebarHidden} aria-expanded={sidebarInteractive} aria-controls="desktop-main-sidebar" data-sidebar-preview-trigger={sidebarHidden || undefined}
      onPointerEnter={(event) => { if (!suppressSidebarHover.current) preview.enter(event) }}
      onPointerLeave={(event) => { suppressSidebarHover.current = false; preview.leave(event) }}
      onClick={() => { suppressSidebarHover.current = !sidebarHidden; runDesktopAction('sidebar') }}>
      {sidebarHidden ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
    </ShellIconButton>
    <ShellIconButton label="搜索服务器、密钥或命令 (Ctrl/Cmd+Shift+K)" onClick={() => setPaletteOpen(true)}><Search size={16} /></ShellIconButton>
  </div>

  return <div className={`eizhu-app desktop-shell ${mac ? 'is-mac' : ''} ${sidebarHidden ? 'sidebar-is-hidden' : ''}`} style={{ '--shell-sidebar-default-width': `${DEFAULT_DESKTOP_SIDEBAR_WIDTH}px`, '--shell-sidebar-inset': `${DESKTOP_SIDEBAR_INSET}px` } as CSSProperties} role="application" aria-label="eizhu">
    <div className="shell-session-view" ref={sessionView} inert={settingsOpen} aria-hidden={settingsOpen || undefined}>
      <div ref={sidebarSpace} className={`shell-sidebar-space ${sidebarHidden ? 'is-collapsed' : ''} ${sidebarButtonMotion ? 'is-button-motion' : ''}`} style={{ width: sidebarHidden ? 0 : visibleSidebarWidth }}>
      <aside ref={sidebar} id="desktop-main-sidebar" className={`eizhu-sidebar shell-sidebar ${sidebarHidden && !preview.present ? 'collapsed' : ''} ${preview.present ? 'is-preview' : ''} ${preview.open ? 'is-preview-open' : ''} ${preview.instantCollapse ? 'is-preview-resting' : ''}`} style={{ width: preview.present ? DEFAULT_DESKTOP_SIDEBAR_WIDTH : visibleSidebarWidth }} aria-label="主导航" aria-hidden={!sidebarInteractive} inert={!sidebarInteractive} onPointerEnter={preview.enter} onPointerLeave={preview.leave}>
        <div className="shell-sidebar-top" data-eizhu-drag-region={desktop || undefined}>{!sidebarHidden && topControls}</div>
        <nav className="shell-primary-nav" aria-label="功能导航">
          <Button variant="ghost" className={!tabs.length || activeTab?.kind === 'terminal' && !activeTab.profileId ? 'is-active' : ''} onClick={() => runDesktopAction('new')}><Plus size={16} /><span>新建连接</span><kbd>{mac ? '⇧⌘T' : 'Ctrl+Shift+T'}</kbd></Button>
          <Button variant="ghost" className={activeTab?.kind === 'sftp' ? 'is-active' : ''} onClick={() => runDesktopAction('sftp')}><FolderUp size={16} /><span>SFTP 文件</span></Button>
          <Button variant="ghost" className={activeTab?.kind === 'vault' ? 'is-active' : ''} onClick={() => openVaultTab()}><KeyRound size={16} /><span>密钥管理</span></Button>
          <Button variant="ghost" onClick={() => runDesktopAction('snippets')}><SquareTerminal size={16} /><span>命令片段</span></Button>
        </nav>
        <div className="shell-lists">
          <section className="shell-servers" aria-label="服务器分组" style={{ flex: serversCollapsed ? '0 0 auto' : '1 1 0' }}>
            <Sidebar visible={sidebarInteractive && !settingsOpen} collapsed={serversCollapsed} onToggle={toggleServers} onAddServer={() => setProfileFormOpen(true)} />
          </section>
        </div>
        <div className="shell-sidebar-footer"><AccountMenu onSettings={openSettings} /></div>
      </aside>
      </div>
      <SidebarResizeHandle width={visibleSidebarWidth} collapsed={sidebarHidden} disabled={settingsOpen} measureWidth={() => sidebarSpace.current?.getBoundingClientRect().width || visibleSidebarWidth} onResize={resizeSidebar} onExpand={expandSidebarToDefault} onCollapse={() => {
        setSidebarButtonMotion(false)
        focusAfterResizeCollapse.current = true
        collapseSidebar()
      }} />
      {sidebarHidden && <div className="shell-fixed-top-controls">{topControls}</div>}
      <main className="shell-workspace">
        <header className="shell-workspace-header" data-eizhu-drag-region={desktop || undefined}>
          {sidebarHidden && <div className="shell-top-controls-slot" aria-hidden="true" />}
          <WorkspaceTabs />
          <div className="shell-workspace-actions" data-eizhu-drag-region={desktop || undefined}>
            <TerminalSplitMenu iconOnly />
            {terminal && <ShellIconButton label="服务器详情" aria-pressed={inspectorOpen} onClick={() => setInspectorOpen((v) => !v)}><PanelRight size={16} /></ShellIconButton>}
            {activeTab && <WorkspaceActions terminal={terminal} />}
          </div>
          {showControls && <div className="shell-window-controls-space" aria-hidden="true" />}
        </header>
        <div className="shell-workspace-body" ref={workspace}>
          <div className="cnt-wrap shell-workspace-content">{tabs.length ? <TerminalView /> : <ConnectionHome onAddServer={() => setProfileFormOpen(true)} />}</div>
          <ServerInspector open={inspectorOpen && !settingsOpen} overlay={workspaceWidth < inspectorWidth + 480} onClose={() => setInspectorOpen(false)} />
        </div>
      </main>
    </div>
    {showControls && <WindowControls className="shell-window-controls" maximized={maximized} onMinimize={minimize} onToggleMaximize={toggleMaximize} onClose={close} />}
    <TunnelDialog open={tunnelsOpen} onOpenChange={setTunnelsOpen} /><TunnelPrompts />
    <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    <ProfileForm open={profileFormOpen} onOpenChange={setProfileFormOpen} />
    {snippetsOpen && <Suspense fallback={null}><SnippetDialog key={workspaceGeneration()} open onOpenChange={setSnippetsOpen} /></Suspense>}
    {settingsOpen && <Suspense fallback={<div className="settings-page settings-page-loading" role="status">正在打开设置…</div>}><SettingsPage key={settingsTab} initialTab={settingsTab} onBack={() => setSettingsOpen(false)} /></Suspense>}
    <Toaster theme={theme} />
  </div>
}
