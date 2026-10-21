import { lazy,Suspense,useEffect,useState } from 'react'
import { X } from 'lucide-react'
import { useSessionStore } from '@/store/session'
import { useDesktopShellStore } from '@/store/desktopShell'
import { ShellIconButton,ShellResizeHandle } from './ShellControls'

const ServerDetail = lazy(() => import('@/components/ServerDetail').then((m) => ({ default: m.ServerDetail })))

export function ServerInspector({ open, overlay, onClose }: { open: boolean; overlay: boolean; onClose: () => void }) {
  const { tabs, activeTabId } = useSessionStore()
  const { inspectorWidth, setInspectorWidth } = useDesktopShellStore()
  const [visited, setVisited] = useState<string[]>([])
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const visible = open && activeTab?.kind === 'terminal' && Boolean(activeTab.profileId)
  useEffect(() => {
    setVisited((previous) => {
      const live = previous.filter((id) => tabs.some((tab) => tab.id === id))
      if (visible && activeTabId && !live.includes(activeTabId)) live.push(activeTabId)
      return live.length === previous.length && live.every((id, i) => id === previous[i]) ? previous : live
    })
  }, [visible, activeTabId, tabs])
  return <aside className={`shell-inspector ${overlay ? 'is-overlay' : ''}`} style={{ width: inspectorWidth }} hidden={!visible} inert={!visible} aria-label="服务器详情">
    <ShellResizeHandle label="调整服务器详情宽度" value={inspectorWidth} min={280} max={480} onChange={setInspectorWidth} reverse />
    <div className="shell-inspector-heading"><span>服务器详情</span><ShellIconButton label="关闭服务器详情" onClick={onClose}><X size={15} /></ShellIconButton></div>
    <div className="shell-inspector-stack">
      {tabs.filter((tab) => visited.includes(tab.id) && tab.kind === 'terminal' && tab.profileId).map((tab) => <div key={tab.id} className="shell-inspector-slot" hidden={tab.id !== activeTabId}>
        <Suspense fallback={<p className="shell-list-empty">加载详情…</p>}>
          <ServerDetail tabId={tab.id} profileId={tab.profileId} profileName={tab.profileName} host={tab.host || '未知'} port={tab.port || 22} username={tab.username || 'root'} active={visible && tab.id === activeTabId} />
        </Suspense>
      </div>)}
    </div>
    <div className="shell-inspector-encoding">终端编码<span>UTF-8</span></div>
  </aside>
}
