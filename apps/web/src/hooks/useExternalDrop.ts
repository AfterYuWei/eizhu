import { useEffect } from 'react'
import { toast } from 'sonner'
import { bridge } from '@/lib/bridge'
import { localFilePath } from '@/lib/localFilePath'
import { getPlatformCapabilities } from '@/lib/platform'
import { hitTestDropTarget } from '@/lib/dragRegistry'
import type { SftpStoreApi } from '@/store/sftp'
/** OS files retain native paths through the restricted webUtils adapter; no filesystem API enters React. */
export function useExternalDrop(store: SftpStoreApi) {
  useEffect(() => {
    if (!getPlatformCapabilities().dragOut) return
    const drop = (event: DragEvent) => {
      const paths = [...(event.dataTransfer?.files ?? [])].map(file => localFilePath(bridge().files.pathForFile(file))).filter(Boolean)
      if (!paths.length) return
      event.preventDefault()
      const state = store.getState(), hit = hitTestDropTarget(event.clientX, event.clientY)
      if (hit?.kind !== 'sftp' || !hit.target.sessionId) return
      const localSession = [...state.leftTabs, ...state.rightTabs].find(tab => tab.server.id === 'local' && tab.sessionId)?.sessionId
      if (!localSession) { toast.warning('本机文件会话尚未连接，无法导入外部文件'); return }
      void state.importExternalPaths(localSession, paths, hit.target)
    }
    document.addEventListener('drop', drop)
    return () => document.removeEventListener('drop', drop)
  }, [store])
}
