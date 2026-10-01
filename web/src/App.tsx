import { listen } from '@tauri-apps/api/event'
import { refreshWorkspace, applyWorkspace, workspaceGeneration, type WorkspaceStatus } from '@/lib/workspace'
import { useSyncStore } from '@/store/sync'
import { useProfileStore } from '@/store/profile'
import { useVaultStore } from '@/store/vault'
import type { SyncStatus } from '@/types/sync'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Layout } from '@/components/Layout'
import { TooltipProvider } from '@/components/ui/tooltip'
import { isMobileRuntime } from '@/lib/platform'
import { initTheme } from '@/store/settings'
import { useAccountStore } from '@/store/account'

// MobileLayout（含 motion 手势库）走动态导入：桌面运行时不加载移动 bundle。
const MobileLayout = lazy(() =>
  import('@/components/MobileLayout').then((module) => ({ default: module.MobileLayout })),
)

// Initialize theme on app load
initTheme()

function App() {
  const [space, setSpace] = useState(0)
  useEffect(() => {
    void refreshWorkspace().then(() => setSpace(workspaceGeneration() ?? 0)).catch(() => {})
    void useAccountStore.getState().hydrate()
    let disposed = false
    const listeners = Promise.all([
      listen<WorkspaceStatus>('eizhu-workspace-changed', ({ payload }) => { applyWorkspace(payload); setSpace(payload.generation) }),
      listen<{ workspaceGeneration: number; status: SyncStatus }>('eizhu-sync-message', ({ payload }) => {
        if (payload.workspaceGeneration !== workspaceGeneration()) return
        const previous = useSyncStore.getState().status
        useSyncStore.setState({ status: payload.status })
        if (payload.status.conflictCount !== previous?.conflictCount || (payload.status.conflictCount > 0 && payload.status.cursor !== previous?.cursor)) void useSyncStore.getState().refresh()
        if (payload.status.cursor !== previous?.cursor) {
          void useProfileStore.getState().refreshAll()
          void useVaultStore.getState().fetchList()
        }
      }),
    ]).then((unlisten) => { if (disposed) unlisten.forEach((fn) => fn()); return unlisten }).catch(() => [])
    const online = () => { void import('@/api/sync').then(({ syncApi }) => syncApi.syncNow()).catch(() => {}) }
    window.addEventListener('online', online)
    return () => { disposed = true; window.removeEventListener('online', online); void listeners.then((unlisten) => unlisten.forEach((fn) => fn())) }
  }, [])
  return (
    <TooltipProvider>
      {isMobileRuntime()
        ? (
          <Suspense fallback={null}>
            <MobileLayout key={space} />
          </Suspense>
        )
        : <Layout key={space} />}
    </TooltipProvider>
  )
}

export default App
