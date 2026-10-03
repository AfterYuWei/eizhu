import { geometry } from '@/lib/terminalLayout'
import { useTerminalLayoutStore } from '@/store/terminalLayout'
import { SplitToolbar, SplitResizeHandle } from './SplitControls'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { runDesktopAction } from '@/lib/desktopActions'
import { isMobileRuntime } from '@/lib/platform'
import { lazy, Suspense, useRef, type CSSProperties } from 'react'
import { useSessionStore } from '@/store/session'
import { useSettingsStore, useResolvedTheme } from '@/store/settings'
import { getTerminalThemeMeta, resolveTerminalThemeId } from '@/lib/terminalThemes'

const TerminalPane = lazy(() =>
  import('./TerminalPane').then((module) => ({ default: module.TerminalPane })),
)
const SftpView = lazy(() =>
  import('@/components/Sftp/SftpView').then((module) => ({ default: module.SftpView })),
)
const VaultView = lazy(() =>
  import('@/components/Vault/VaultView').then((module) => ({ default: module.VaultView })),
)

/** Content router: renders SftpView for sftp-kind tabs, VaultView for vault-kind, TerminalPane otherwise. */
export function TerminalView() {
  const { tabs, activeTabId } = useSessionStore()
  const host = useRef<HTMLDivElement>(null)
  const { tree, maximizedId } = useTerminalLayoutStore()
  const layout = geometry(tree)
  const splitEnabled = !isMobileRuntime() && activeTabId !== null
  const { terminalTheme } = useSettingsStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isWide = activeTab?.kind === 'sftp' || activeTab?.kind === 'vault'

  // 与 TerminalPane 相同的解析：'default' 主题跟随应用深浅色
  const resolvedAppTheme = useResolvedTheme()
  const themeMeta = getTerminalThemeMeta(resolveTerminalThemeId(terminalTheme, resolvedAppTheme))
  const termBg = themeMeta.theme.background
  // The outer boundary follows the application chrome rather than the terminal
  // palette, so light terminal themes remain distinct from the surrounding UI.
  const termBorder = 'var(--surface-border)'

  return (
    <div
      className={`term-wrap ${isWide ? 'sftp-aware' : ''}`}
      style={{
        '--term-bg': termBg,
        '--term-border': termBorder,
      } as CSSProperties}
    >
      {splitEnabled && !isWide && <SplitToolbar />}
      <div ref={host} className="flex-1 relative overflow-hidden">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          if (tab.kind === 'sftp') {
            return (
              <div
                key={tab.id}
                className={`absolute inset-0 ${active ? 'block' : 'hidden'}`}
              >
                <Suspense fallback={<div className="h-full bg-[var(--bg)]" />}>
                  <SftpView initialProfileId={tab.profileId || undefined} initialPath={tab.cwd} />
                </Suspense>
              </div>
            )
          }
          if (tab.kind === 'vault') {
            return (
              <div
                key={tab.id}
                className={`absolute inset-0 ${active ? 'block' : 'hidden'}`}
              >
                <Suspense fallback={<div className="h-full bg-[var(--bg)]" />}>
                  <VaultView />
                </Suspense>
              </div>
            )
          }
          const rectangle = splitEnabled && !isWide ? layout.panes.find((pane) => pane.tabId === tab.id) : undefined
          const visible = !isWide && (splitEnabled ? (maximizedId ? tab.id === maximizedId : Boolean(rectangle) || (!tree && active)) : active)
          const style: CSSProperties = rectangle && !maximizedId
            ? { left: `${rectangle.x}%`, top: `${rectangle.y}%`, width: `${rectangle.width}%`, height: `${rectangle.height}%` }
            : { inset: 0 }
          return (
            <div key={tab.id} data-terminal-tab={tab.id} className={`absolute flex-col ${visible ? 'flex' : 'hidden'}`} style={style}
              onPointerDownCapture={() => { if (useSessionStore.getState().activeTabId !== tab.id) useSessionStore.getState().setActiveTab(tab.id) }}>
              {splitEnabled && !isWide && <div className={`flex h-7 shrink-0 items-center gap-2 border-b border-border px-2 text-xs ${active ? 'bg-accent text-accent-foreground' : 'bg-background text-muted-foreground'}`}>
                <button className="min-w-0 flex-1 truncate text-left" onClick={() => useSessionStore.getState().setActiveTab(tab.id)}>{tab.profileName}</button>
                <Button variant="ghost" size="icon-xs" title="关闭窗格与对应标签" onClick={() => runDesktopAction('close', tab.id)}><X size={12} /></Button>
              </div>}
              <div className="relative min-h-0 flex-1"><Suspense fallback={<div className="h-full bg-[var(--term-bg)]" />}>
                <TerminalPane tab={tab} isActive={active && visible} isVisible={visible} />
              </Suspense></div>
            </div>
          )
        })}
        {splitEnabled && !isWide && !maximizedId && layout.handles.map((handle) => <SplitResizeHandle key={handle.id} handle={handle} host={host} />)}
      </div>
    </div>
  )
}
