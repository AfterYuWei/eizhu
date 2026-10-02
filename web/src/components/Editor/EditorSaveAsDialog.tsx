import { useState } from 'react'
import { useEditorStore, type EditorTab } from '@/store/editor'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function EditorSaveAsDialog({ tab, onClose }: { tab: EditorTab; onClose: () => void }) {
  const [path, setPath] = useState(`${tab.path}.copy`)
  const [busy, setBusy] = useState(false)
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}><DialogContent>
    <DialogHeader><DialogTitle>另存为新文件</DialogTitle></DialogHeader>
    <p className="text-sm text-muted-foreground">保存到同一连接中的新路径。已有目标会被拒绝，失败时保留全部编辑内容。</p>
    <Input aria-label="新文件路径" value={path} onChange={(e) => setPath(e.target.value)} disabled={busy} />
    <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy || !path.trim()} onClick={() => {
      setBusy(true)
      void useEditorStore.getState().saveAs(tab.id, path).then((saved) => { if (saved) onClose() }).finally(() => setBusy(false))
    }}>{busy ? '保存中…' : '保存新文件'}</Button></div>
  </DialogContent></Dialog>
}
