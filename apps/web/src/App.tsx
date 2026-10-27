import { toast } from 'sonner'
import { bridge } from '@/lib/bridge'
import { listen } from '@/lib/bridge';
import { refreshWorkspace,applyWorkspace,workspaceGeneration } from '@/lib/workspace';
import { useSyncStore } from '@/store/sync';
import { useProfileStore } from '@/store/profile';
import { useVaultStore } from '@/store/vault';
import { useEffect,useState } from 'react';
import { Layout } from '@/components/Layout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { initTheme } from '@/store/settings';
import { useAccountStore } from '@/store/account';
// Initialize theme on app load
initTheme();
function App() {
    const [space, setSpace] = useState(0);
    useEffect(() => {
        void refreshWorkspace().then(() => setSpace(workspaceGeneration() ?? 0)).catch(() => { });
        void useAccountStore.getState().hydrate();
        let disposed = false;
        const listeners = Promise.all([
            listen('eizhu-account-message', ({ payload }) => {
                useAccountStore.setState({ status: payload.status, loading: false, error: null });
            }),
            listen('eizhu-runtime-state', ({ payload }) => {
              if (payload.status === 'ready') { toast.dismiss('runtime-unavailable'); return }
              toast.error(payload.message ?? '业务进程不可用', { id: 'runtime-unavailable', duration: Infinity, action: { label: '恢复服务', onClick: () => { void bridge().runtime.restart().catch(error => toast.error(error instanceof Error ? error.message : String(error))) } } })
            }),

            listen('eizhu-workspace-changed', ({ payload }) => { applyWorkspace(payload); setSpace(payload.generation); }),
            listen('eizhu-sync-message', ({ payload }) => {
                if (payload.workspaceGeneration !== workspaceGeneration())
                    return;
                const previous = useSyncStore.getState().status;
                useSyncStore.setState({ status: payload.status });
                if (payload.status.conflictCount !== previous?.conflictCount || (payload.status.conflictCount > 0 && payload.status.cursor !== previous?.cursor))
                    void useSyncStore.getState().refresh();
                if (payload.refresh || payload.status.cursor !== previous?.cursor) {
                    void useProfileStore.getState().refreshAll();
                    void useVaultStore.getState().fetchList();
                    window.dispatchEvent(new Event('eizhu-items-changed'));
                }
            }),
        ]).then((unlisten) => { if (disposed)
            unlisten.forEach((fn) => fn()); return unlisten; }).catch(() => []);
        const online = () => { const status=useSyncStore.getState().status;if(status?.status!=='offline'&&status?.lastErrorCode!=='ACCOUNT_UNAVAILABLE')return;void import('@/api/sync').then(({ syncApi }) => syncApi.syncNow()).catch(() => { }); };
        window.addEventListener('online', online);
        return () => { disposed = true; window.removeEventListener('online', online); void listeners.then((unlisten) => unlisten.forEach((fn) => fn())); };
    }, []);
    return (<TooltipProvider>
      {<Layout key={space}/>}
    </TooltipProvider>);
}
export default App;
