import { bridge } from './bridge'
import { isDesktopRuntime } from './platform'
export async function openExternal(url: string): Promise<void> {
  if (isDesktopRuntime()) await bridge().system.openExternal({ url })
  else if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
}
export function saveTextToDisk(content: string, suggestedName: string): Promise<string | null> {
  return bridge().system.saveText({ content, suggestedName })
}
export interface DragOutResult { files: string[]; icon: string }
export async function sftpDragOut(_sourceSessionId: string, _localSessionId: string, _paths: string[]): Promise<DragOutResult> {
  throw new Error('系统拖出将在阶段 4 开放')
}
export async function startNativeFileDrag(_files: string[], _icon: string): Promise<void> {
  throw new Error('系统拖出将在阶段 4 开放')
}
