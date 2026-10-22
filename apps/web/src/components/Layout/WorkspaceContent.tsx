import { Loading } from '@/components/ui/loading'
import { lazy, Suspense } from 'react'
import { TerminalView } from '@/components/Terminal'
import { useSessionStore } from '@/store/session'
import { useWorkspaceViewStore } from '@/store/workspaceView'
import { ConnectionHome } from './ConnectionHome'

const SftpView = lazy(() => import('@/components/Sftp/SftpView').then((m) => ({ default: m.SftpView })))
const VaultView = lazy(() => import('@/components/Vault/VaultView').then((m) => ({ default: m.VaultView })))

export function WorkspaceContent({ onAddServer }: { onAddServer: () => void }) {
  const hasTerminals = useSessionStore((state) => state.tabs.length > 0)
  const { activePage, sftpStore, vaultOpened } = useWorkspaceViewStore()
  return <>
    <div className="shell-page" hidden={activePage !== 'terminal'} inert={activePage !== 'terminal'}>
      {hasTerminals ? <TerminalView /> : <ConnectionHome onAddServer={onAddServer} />}
    </div>
    {sftpStore && <section id="workspace-sftp" className="shell-page" aria-label="SFTP 文件" hidden={activePage !== 'sftp'} inert={activePage !== 'sftp'}>
      <Suspense fallback={<Loading />}><SftpView store={sftpStore} /></Suspense>
    </section>}
    {vaultOpened && <section id="workspace-vault" className="shell-page" aria-label="密钥管理" hidden={activePage !== 'vault'} inert={activePage !== 'vault'}>
      <Suspense fallback={<Loading />}><VaultView /></Suspense>
    </section>}
  </>
}
