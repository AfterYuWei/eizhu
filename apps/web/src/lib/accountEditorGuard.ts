import { bridge } from './bridge'
import { isDesktopRuntime } from './platform'

/** Confirmation is owned by the editor webview; false leaves the account intact. */
export async function confirmAccountEditorChange(): Promise<boolean> {
  return isDesktopRuntime() ? bridge().editor.confirmTransition() : true
}
