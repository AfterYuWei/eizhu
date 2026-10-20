import { bridge } from './bridge'
import { toast } from 'sonner'
import { useEditorStore,type EditorSessionType } from '@/store/editor'
import { isDesktopRuntime } from '@/lib/platform'

/** Open a file in the desktop editor window . */
export async function openEditorFile(
  sessionId: string,
  sessionType: EditorSessionType,
  path: string,
): Promise<void> {
  if (!isDesktopRuntime()) {
    await useEditorStore.getState().openFile(sessionId, sessionType, path)
    return
  }

  try {
    await bridge().editor.open({ sessionId, sessionType, path })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast.error('无法打开编辑器窗口', { description: message })
  }
}
