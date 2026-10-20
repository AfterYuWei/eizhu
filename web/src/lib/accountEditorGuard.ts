import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from './platform'

/** Confirmation is owned by the editor webview; false leaves the account intact. */
export async function confirmAccountEditorChange(): Promise<boolean> {
  return isDesktopRuntime() ? invoke<boolean>('request_editor_transition') : true
}
