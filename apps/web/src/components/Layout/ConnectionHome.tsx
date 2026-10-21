import { FolderUp,KeyRound,Plus,SquareTerminal } from 'lucide-react'
import { useProfileStore } from '@/store/profile'
import { useWorkspaceViewStore } from '@/store/workspaceView'
import { runDesktopAction } from '@/lib/desktopActions'
import { Button } from '@/components/ui/button'

export function ConnectionHome({ onAddServer }: { onAddServer: () => void }) {
  const profiles = useProfileStore((s) => s.profiles)
  const loading = useProfileStore((s) => s.loading)
  return <div className="shell-home">
    <div className="shell-home-content">
      <h1>eizhu</h1>
      <p className="shell-home-subtitle">连接你的服务器</p>
      <div className="shell-home-shortcuts">
        <Button variant="outline" onClick={() => runDesktopAction('new')}><Plus size={15} />新建连接</Button>
        <Button variant="outline" onClick={() => void useWorkspaceViewStore.getState().openSftp()}><FolderUp size={15} />SFTP 文件</Button>
        <Button variant="outline" onClick={() => useWorkspaceViewStore.getState().openVault()}><KeyRound size={15} />密钥管理</Button>
        <Button variant="outline" onClick={() => runDesktopAction('snippets')}><SquareTerminal size={15} />命令片段</Button>
      </div>
      {!loading && !profiles.length && <Button variant="link" className="shell-home-add" onClick={onAddServer}><Plus size={14} />新增第一台服务器</Button>}
    </div>
  </div>
}
