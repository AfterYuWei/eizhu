import { geometry,type PaneRect } from '@/lib/terminalLayout';
import { useTerminalLayoutStore } from '@/store/terminalLayout';
import { SplitResizeHandle } from './SplitControls';
import { cn } from '@/lib/utils';
import { lazy,Suspense,useRef,type CSSProperties } from 'react';
import { useSessionStore } from '@/store/session';
import { useSettingsStore,useResolvedTheme } from '@/store/settings';
import { getTerminalThemeMeta,resolveTerminalThemeId } from '@/lib/terminalThemes';
const TerminalPane = lazy(() => import('./TerminalPane').then((module) => ({ default: module.TerminalPane })));
const SftpView = lazy(() => import('@/components/Sftp/SftpView').then((module) => ({ default: module.SftpView })));
const VaultView = lazy(() => import('@/components/Vault/VaultView').then((module) => ({ default: module.VaultView })));
/** Keep an 8px workspace gap between independent terminal cards. */
function paneStyle(rectangle: PaneRect, split: boolean): CSSProperties {
    const left = split && rectangle.x > 0 ? 4 : 0;
    const top = split && rectangle.y > 0 ? 4 : 0;
    const right = split && rectangle.x + rectangle.width < 99.999 ? 4 : 0;
    const bottom = split && rectangle.y + rectangle.height < 99.999 ? 4 : 0;
    return {
        left: `calc(${rectangle.x}% + ${left}px)`,
        top: `calc(${rectangle.y}% + ${top}px)`,
        width: `calc(${rectangle.width}% - ${left + right}px)`,
        height: `calc(${rectangle.height}% - ${top + bottom}px)`,
    };
}
/** Content router: renders SftpView for sftp-kind tabs, VaultView for vault-kind, TerminalPane otherwise. */
export function TerminalView() {
    const { tabs, activeTabId } = useSessionStore();
    const host = useRef<HTMLDivElement>(null);
    const { tree, maximizedId } = useTerminalLayoutStore();
    const layout = geometry(tree);
    const splitEnabled = activeTabId !== null;
    const { terminalTheme } = useSettingsStore();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const isWide = activeTab?.kind === 'sftp' || activeTab?.kind === 'vault';
    const split = splitEnabled && !isWide && !maximizedId && layout.panes.length > 1;
    // 与 TerminalPane 相同的解析：'default' 主题跟随应用深浅色
    const resolvedAppTheme = useResolvedTheme();
    const themeMeta = getTerminalThemeMeta(resolveTerminalThemeId(terminalTheme, resolvedAppTheme));
    const termBg = themeMeta.theme.background;
    // The outer boundary follows the application chrome rather than the terminal
    // palette, so light terminal themes remain distinct from the surrounding UI.
    const termBorder = 'var(--surface-border)';
    return (<div className={cn('term-wrap', isWide ? 'sftp-aware' : 'terminal-layout')} style={{
            '--term-bg': termBg,
            '--term-border': termBorder,
        } as CSSProperties}>
      <div ref={host} className={cn('term-workspace', split && 'is-split')}>
        {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            if (tab.kind === 'sftp') {
                return (<div key={tab.id} className={`absolute inset-0 ${active ? 'block' : 'hidden'}`}>
                <Suspense fallback={<div className="h-full bg-[var(--bg)]"/>}>
                  <SftpView initialProfileId={tab.profileId || undefined} initialPath={tab.cwd}/>
                </Suspense>
              </div>);
            }
            if (tab.kind === 'vault') {
                return (<div key={tab.id} className={`absolute inset-0 ${active ? 'block' : 'hidden'}`}>
                <Suspense fallback={<div className="h-full bg-[var(--bg)]"/>}>
                  <VaultView />
                </Suspense>
              </div>);
            }
            const rectangle = splitEnabled && !isWide ? layout.panes.find((pane) => pane.tabId === tab.id) : undefined;
            const visible = !isWide && (splitEnabled ? (maximizedId ? tab.id === maximizedId : Boolean(rectangle) || (!tree && active)) : active);
            const style: CSSProperties = rectangle && !maximizedId
                ? paneStyle(rectangle, Boolean(split))
                : { inset: 0 };
            return (<div key={tab.id} data-terminal-tab={tab.id} role="group" aria-label={`终端窗格 · ${tab.profileName}`} className={cn('term-pane', active && 'is-active', !visible && 'is-hidden')} style={style} onPointerDownCapture={() => { if (useSessionStore.getState().activeTabId !== tab.id)
                useSessionStore.getState().setActiveTab(tab.id); }}>
              <div className={cn('relative min-h-0 flex-1', 'term-pane-card')}><Suspense fallback={<div className="h-full bg-[var(--term-bg)]"/>}>
                <TerminalPane tab={tab} isActive={active && visible} isVisible={visible}/>
              </Suspense></div>
            </div>);
        })}
        {splitEnabled && !isWide && !maximizedId && layout.handles.map((handle) => <SplitResizeHandle key={handle.id} handle={handle} host={host}/>)}
      </div>
    </div>);
}
