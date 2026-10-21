import { create } from 'zustand'
import { createSftpStore, type SftpStoreApi } from './sftp'
import { workspaceGeneration } from '@/lib/workspaceScope'

type WorkspacePage = 'terminal' | 'sftp' | 'vault'

interface WorkspaceViewState {
  activePage: WorkspacePage
  sftpStore: SftpStoreApi | null
  vaultOpened: boolean
  showTerminal: () => void
  openSftp: (profileId?: string, path?: string) => Promise<void>
  openVault: () => void
}

let serversReady: Promise<void> = Promise.resolve()
let navigation: Promise<void> = Promise.resolve()
let navigationId = 0

/** 工具页面归当前工作空间所有，与终端标签独立。 */
export const useWorkspaceViewStore = create<WorkspaceViewState>((set, get) => ({
  activePage: 'terminal',
  sftpStore: null,
  vaultOpened: false,
  showTerminal: () => set({ activePage: 'terminal' }),
  openVault: () => set({ activePage: 'vault', vaultOpened: true }),
  openSftp: async (profileId, path) => {
    let store = get().sftpStore
    if (!store) {
      store = createSftpStore({ includeLocalTab: true })
      serversReady = store.getState().loadServers()
    }
    set({ activePage: 'sftp', sftpStore: store })
    if (!profileId) return

    const ready = serversReady
    const target = store
    const generation = workspaceGeneration()
    const request = ++navigationId
    const current = () => get().sftpStore === target && generation === workspaceGeneration() && request === navigationId
    // 串行复用内部连接；过期请求不得覆盖较新的目录定位。
    const task = navigation.then(async () => {
      await ready
      if (!current()) return
      if (!target.getState().servers.some((item) => item.id === profileId)) {
        await target.getState().loadServers()
        if (!current()) return
      }
      const server = target.getState().servers.find((item) => item.id === profileId)
      if (!server) throw new Error('找不到对应的服务器配置')
      await target.getState().connectServer('right', server)
      if (current() && path) await target.getState().navigate('right', path)
    })
    navigation = task.catch(() => undefined)
    await task
  },
}))

/** 显式结束旧空间的文件资源，不依赖 React 卸载。 */
export async function resetWorkspaceView() {
  const store = useWorkspaceViewStore.getState().sftpStore
  navigationId++
  serversReady = Promise.resolve()
  navigation = Promise.resolve()
  useWorkspaceViewStore.setState(useWorkspaceViewStore.getInitialState(), true)
  await store?.getState().dispose()
}
