import { Loading } from '@/components/ui/loading'
import { lazy,Suspense,useEffect,useState } from 'react'
import { ChevronDown,FolderOpen,X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspaceViewStore } from '@/store/workspaceView'
import { useSessionStore } from '@/store/session'
import { useDesktopShellStore } from '@/store/desktopShell'
import { ShellIconButton,ShellResizeHandle } from './ShellControls'

const ServerDetail = lazy(() => import('@/components/ServerDetail').then((m) => ({ default: m.ServerDetail })))

export function ServerInspector({ open, overlay, onClose, onChoose }: { open: boolean; overlay: boolean; onClose: () => void; onChoose: () => void }) {
  const { tabs, activeTabId } = useSessionStore()
  const { inspectorWidth, setInspectorWidth } = useDesktopShellStore()
  const [visited, setVisited] = useState<string[]>([])
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const activePage = useWorkspaceViewStore((state) => state.activePage)
  const visible = open && activePage === 'terminal' && Boolean(activeTab?.profileId)
  useEffect(() => {
    setVisited((previous) => {
      const live = previous.filter((id) => tabs.some((tab) => tab.id === id))
      if (visible && activeTabId && !live.includes(activeTabId)) live.push(activeTabId)
      return live.length === previous.length && live.every((id, i) => id === previous[i]) ? previous : live
    })
  }, [visible, activeTabId, tabs])
  return <aside className={`shell-inspector ${overlay ? 'is-overlay' : ''}`} style={{ width: inspectorWidth }} hidden={!visible} inert={!visible} aria-label="服务器详情">
    <ShellResizeHandle label="调整右侧栏宽度" value={inspectorWidth} min={320} max={560} onChange={setInspectorWidth} reverse />
    <div className="shell-inspector-heading"><Button variant="ghost" className="shell-inspector-switch" aria-label="切换侧栏内容" onClick={onChoose}><FolderOpen size={15} />SFTP<ChevronDown size={13} /></Button><ShellIconButton label="关闭右侧栏" onClick={onClose}><X size={15} /></ShellIconButton></div>
    <div className="shell-inspector-stack">
      {tabs.filter((tab) => visited.includes(tab.id) && tab.profileId).map((tab) => <div key={tab.id} className="shell-inspector-slot" hidden={tab.id !== activeTabId}>
        <Suspense fallback={<Loading />}>
          <ServerDetail tabId={tab.id} profileId={tab.profileId} profileName={tab.profileName} host={tab.host || '未知'} port={tab.port || 22} username={tab.username || 'root'} active={visible && tab.id === activeTabId} />
        </Suspense>
      </div>)}
    </div>
    <div className="shell-inspector-encoding">终端编码<span>UTF-8</span></div>
  </aside>
}
