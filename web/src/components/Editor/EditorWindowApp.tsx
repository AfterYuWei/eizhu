import { TooltipProvider } from '@/components/ui/tooltip'
import { initTheme } from '@/store/settings'
import { EditorWindowPage } from './EditorWindowPage'
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { workspaceGeneration, setWorkspaceGeneration } from '@/lib/workspaceScope'
import { useEditorStore } from '@/store/editor'

initTheme()

export default function EditorWindowApp() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let stop: (() => void) | undefined
    void listen<{ generation: number }>('eizhu-workspace-changed', ({ payload }) => {
      setWorkspaceGeneration(payload.generation)
      // Unexpected space changes preserve the buffer while preventing old writes.
      useEditorStore.setState((s) => ({ tabs: s.tabs.map((t) => ({ ...t, readOnly: true, error: '数据空间已变化，本地内容已保留，请复制内容后重新打开连接' })) }))
    }).then(async (unlisten) => {
      if (!active) { unlisten(); return }
      stop = unlisten
      const status = await invoke<{ generation: number }>('workspace_status')
      if (!active) return
      if (workspaceGeneration() === undefined) setWorkspaceGeneration(status.generation)
      setReady(true)
    }).catch((cause) => { if (active) { setError(String(cause)); void invoke('editor_window_show').catch(() => {}) } })
    return () => { active = false; stop?.() }
  }, [])
  if (!ready) return <p className="p-6 text-sm">{error || '正在载入数据空间…'}</p>
  return (
    <TooltipProvider>
      <EditorWindowPage />
    </TooltipProvider>
  )
}
