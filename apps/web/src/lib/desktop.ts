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
export async function sftpDragOut(sourceSessionId: string, _localSessionId: string, paths: string[],signal?:AbortSignal): Promise<DragOutResult> {
  signal?.throwIfAborted()
  const {tasks}=await bridge().sftp.prepareDrag({sessionId:sourceSessionId,paths})
  const ids=tasks.map(t=>t.id),deadline=Date.now()+120000
  try{while(Date.now()<deadline){signal?.throwIfAborted();const current=await bridge().sftp.listTransfers({sessionId:undefined,status:undefined});const owned=current.filter(t=>ids.includes(t.id));const failed=owned.find(t=>['failed','cancelled','paused','recoverable'].includes(t.status));if(failed)throw new Error(failed.error_message??'文件物化已中断');if(owned.length===ids.length&&owned.every(t=>t.status==='completed')){signal?.throwIfAborted();return {files:ids,icon:''}}await new Promise(resolve=>setTimeout(resolve,250))}throw new Error('文件物化超时，请重新拖出')}
  catch(error){await bridge().sftp.releaseDrag({taskIds:ids}).catch(()=>undefined);throw error}
}
export async function startNativeFileDrag(files: string[], _icon: string): Promise<void> {
  try{await bridge().sftp.startDrag({taskIds:files})}catch(error){await bridge().sftp.releaseDrag({taskIds:files}).catch(()=>undefined);throw error}
}
