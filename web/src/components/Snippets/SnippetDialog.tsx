import { useEffect, useState } from 'react'
import { useSessionStore } from '@/store/session'
import { toast } from 'sonner'
import { snippetApi } from '@/api/snippet'
import type { Snippet } from '@/types/snippet'
import { snippetTarget, insertSnippet, multilineSnippet, type SnippetTarget } from '@/lib/snippetInsertion'
import { terminalActions } from '@/lib/terminalActions'
import { writeClipboardText } from '@/lib/clipboard'
import { focusActiveTerminal } from '@/lib/desktopActions'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface Draft { id?: string; name: string; content: string; description: string; tags: string }
const emptyDraft: Draft = { name: '', content: '', description: '', tags: '' }
export function SnippetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [preview, setPreview] = useState<{ snippet: Snippet; target: SnippetTarget | null } | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try { await work() } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!open) return
    let active = true
    void snippetApi.list().then((items) => { if (active) setSnippets(items) }).catch((e) => toast.error(String(e)))
    return () => { active = false }
  }, [open])
  const save = async () => {
    if (!draft?.name.trim() || !draft.content.trim()) throw new Error('请填写片段名称和内容')
    const payload = { name: draft.name.trim(), content: draft.content, description: draft.description, tags: draft.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) }
    const result = draft.id ? await snippetApi.update(draft.id, payload) : await snippetApi.create(payload)
    setSnippets((items) => [...items.filter((item) => item.id !== result.id), result])
    setDraft(null)
  }
  const insert = (snippet: Snippet) => {
    const target = snippetTarget()
    if (!target) { toast.error('请先选择已连接的终端'); return }
    if (multilineSnippet(snippet.content)) setPreview({ snippet, target })
    else {
      try { insertSnippet(target, snippet.content); onOpenChange(false) } catch (e) { toast.error(String(e)) }
    }
  }
  const sendPreview = (execute: boolean) => {
    if (!preview?.target) return
    try { insertSnippet(preview.target, preview.snippet.content, execute); setPreview(null); onOpenChange(false) }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }
  const safePreview = preview?.target && (!multilineSnippet(preview.snippet.content) || terminalActions(preview.target.tabId)?.safeMultiline())
  const matches = snippets.filter((s) => `${s.name} ${s.description} ${s.tags.join(' ')} ${s.content}`.toLowerCase().includes(query.toLowerCase()))
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
    <DialogContent className="max-w-3xl" onCloseAutoFocus={(e) => { e.preventDefault(); focusActiveTerminal() }}>
      <DialogHeader><DialogTitle>{preview ? '预览命令片段' : draft ? (draft.id ? '编辑片段' : '新建片段') : '命令片段'}</DialogTitle></DialogHeader>
      {preview ? <div className="space-y-3">
        <p className="text-sm">{preview.snippet.name} · 目标：{terminalLabel(preview.target?.tabId)}</p>
        <pre className="max-h-80 overflow-auto rounded-lg border bg-muted p-3 text-sm whitespace-pre-wrap">{preview.snippet.content}</pre>
        <p className="text-xs text-muted-foreground">插入不会附加回车；执行会在粘贴后提交回车。请检查完整内容和目标终端。</p>
        {!safePreview && <p className="text-sm text-destructive">当前终端未启用安全的多行粘贴，请使用复制入口。</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setPreview(null)}>返回</Button>
          <Button variant="outline" onClick={() => void run(async () => { await writeClipboardText(preview.snippet.content); toast.success('已复制片段') })}>复制内容</Button>
          <Button disabled={!safePreview} onClick={() => sendPreview(false)}>只插入</Button>
          <Button variant="destructive" disabled={!safePreview} onClick={() => sendPreview(true)}>明确执行这段命令</Button>
        </div>
      </div> : draft ? <div className="space-y-3">
        <Label htmlFor="snippet-name">名称</Label><Input id="snippet-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <Label htmlFor="snippet-content">内容</Label><Textarea id="snippet-content" className="min-h-48 font-mono" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        <Input aria-label="描述" placeholder="描述" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        <Input aria-label="标签" placeholder="标签，逗号分隔" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
        <div className="flex gap-2"><Button disabled={busy} onClick={() => void run(save)}>保存</Button><Button variant="outline" disabled={busy} onClick={() => setDraft(null)}>取消</Button></div>
      </div> : <div className="space-y-3">
        <p className="text-xs text-muted-foreground">片段沿用账号同步和完整备份。单行默认只插入，多行先预览。</p>
        <div className="flex gap-2"><Input aria-label="搜索片段" placeholder="搜索名称、标签或内容…" value={query} onChange={(e) => setQuery(e.target.value)} /><Button onClick={() => setDraft({ ...emptyDraft })}>新建片段</Button></div>
        <div className="max-h-96 space-y-2 overflow-auto">
          {matches.map((s) => <div key={s.id} className="space-y-2 rounded-lg border p-3">
            <p className="font-medium">{s.name}</p><p className="text-xs text-muted-foreground">{s.description} {s.tags.join(' · ')}</p><pre className="max-h-20 overflow-hidden whitespace-pre-wrap text-xs">{s.content}</pre>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => insert(s)}>插入终端</Button>
              <Button size="sm" variant="outline" onClick={() => setPreview({ snippet: s, target: snippetTarget() })}>预览与执行</Button>
              <Button size="sm" variant="outline" onClick={() => void run(async () => { await writeClipboardText(s.content); toast.success('已复制片段') })}>复制</Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft({ ...s, tags: s.tags.join(', ') })}>编辑</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
                if (deleteId !== s.id) { setDeleteId(s.id); return }
                void run(async () => { await snippetApi.delete(s.id); setSnippets((items) => items.filter((item) => item.id !== s.id)); setDeleteId(null) })
              }}>{deleteId === s.id ? '确认删除' : '删除'}</Button>
            </div>
          </div>)}
          {!matches.length && <p className="text-sm text-muted-foreground">暂无匹配片段</p>}
        </div>
      </div>}
    </DialogContent>
  </Dialog>
}

function terminalLabel(tabId?: string) {
  return tabId ? useSessionStore.getState().tabs.find((t) => t.id === tabId)?.profileName ?? '终端已关闭' : '未选择终端'
}
