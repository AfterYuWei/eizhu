import { useState } from 'react'
import { useEditorStore, type EditorTab } from '@/store/editor'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export function EditorMergeDialog({ tab }: { tab: EditorTab }) {
  const preview = tab.mergePreview!
  const [merged, setMerged] = useState(preview.localContent)
  return <Dialog open onOpenChange={(open) => { if (!open) useEditorStore.getState().dismissMerge(tab.id) }}>
    <DialogContent className="max-w-[min(1200px,95vw)]">
      <DialogHeader><DialogTitle>比较与手动合并 · {tab.filename}</DialogTitle></DialogHeader>
      <p className="text-xs text-muted-foreground">保留本地修改，核对三份内容后编辑合并结果。应用合并不会立即保存，保存时会再次核对远端。</p>
      <div className="grid grid-cols-3 gap-3">
        {[
          ['打开时内容', preview.openingContent],
          ['本地内容', preview.localContent],
          ['最新远端内容', preview.remoteContent],
        ].map(([label, content]) => <label key={label} className="space-y-2 text-sm">{label}<Textarea aria-label={label} readOnly className="h-56 font-mono text-xs" value={content} /></label>)}
      </div>
      <label className="space-y-2 text-sm">手动合并结果<Textarea aria-label="手动合并结果" className="h-48 font-mono" value={merged} onChange={(e) => setMerged(e.target.value)} /></label>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => useEditorStore.getState().dismissMerge(tab.id)}>取消，保留本地修改</Button>
        <Button onClick={() => useEditorStore.getState().mergeFile(tab.id, merged)}>应用合并，返回编辑器</Button>
      </div>
    </DialogContent>
  </Dialog>
}
