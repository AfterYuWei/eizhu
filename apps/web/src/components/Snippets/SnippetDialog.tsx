import { useEffect,useState } from 'react'
import { Plus, Search, SquareTerminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { snippetApi } from '@/api/snippet'
import type { Snippet } from '@/types/snippet'
import { snippetTarget,insertSnippet,multilineSnippet,type SnippetTarget } from '@/lib/snippetInsertion'
import { recordSnippetUse } from '@/lib/snippetQuickAccess'
import { SnippetPreview } from './SnippetPreview'
import { writeClipboardText } from '@/lib/clipboard'
import { focusActiveTerminal } from '@/lib/desktopActions'
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import '@/styles/snippets.css'

interface Draft { id?: string; name: string; content: string; description: string; tags: string }
const emptyDraft: Draft = { name: '', content: '', description: '', tags: '' }
export function SnippetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [preview, setPreview] = useState<{ snippet: Snippet; target: SnippetTarget | null } | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try { await work() } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setLoadError(false)
    void snippetApi.list().then((items) => { if (active) setSnippets(items) })
      .catch(() => { if (active) setLoadError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, attempt])
  const save = async () => {
    if (!draft?.name.trim() || !draft.content.trim()) throw new Error('请填写片段名称和内容')
    const payload = { name: draft.name.trim(), content: draft.content, description: draft.description, tags: draft.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) }
    const result = draft.id ? await snippetApi.update(draft.id, payload) : await snippetApi.create(payload)
    setSnippets((items) => [...items.filter((item) => item.id !== result.id), result])
    setQuery('')
    setSelectedId(result.id)
    setDraft(null)
  }
  const insert = (snippet: Snippet) => {
    const target = snippetTarget()
    if (!target) { toast.error('请先选择已连接的终端'); return }
    if (multilineSnippet(snippet.content)) setPreview({ snippet, target })
    else {
      try { insertSnippet(target, snippet.content); recordSnippetUse(snippet.id); onOpenChange(false) } catch (e) { toast.error(String(e)) }
    }
  }
  const sendPreview = (execute: boolean) => {
    if (!preview?.target) return
    try { insertSnippet(preview.target, preview.snippet.content, execute); recordSnippetUse(preview.snippet.id); setPreview(null); onOpenChange(false) }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }
  const matches = snippets.filter((s) => `${s.name} ${s.description} ${s.tags.join(' ')} ${s.content}`.toLowerCase().includes(query.toLowerCase()))
  const selected = matches.find((s) => s.id === selectedId) ?? matches[0]
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
    <DialogContent className="snippet-manager" onCloseAutoFocus={(e) => { e.preventDefault(); focusActiveTerminal() }}>
      <DialogHeader className="snippet-manager-heading">
        <DialogTitle>{preview ? '预览命令片段' : draft ? (draft.id ? '编辑片段' : '新建片段') : '命令片段'}</DialogTitle>
        <DialogDescription>保存在当前工作空间，支持完整备份。单行只插入，多行先预览。</DialogDescription>
      </DialogHeader>
      {preview ? <div className="snippet-manager-body"><SnippetPreview snippet={preview.snippet} target={preview.target} busy={busy} allowExecute
        onBack={() => setPreview(null)} onCopy={() => void run(async () => { await writeClipboardText(preview.snippet.content); toast.success('已复制片段') })}
        onInsert={sendPreview} /></div> : draft ? <form className="snippet-editor snippet-manager-body" onSubmit={(event) => { event.preventDefault(); void run(save) }}>
        <fieldset className="snippet-fields" disabled={busy}>
          <div className="snippet-group snippet-basic-fields">
            <div className="snippet-field"><Label htmlFor="snippet-name">名称</Label><Input id="snippet-name" autoFocus placeholder="例如：检查磁盘空间" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div className="snippet-field"><Label htmlFor="snippet-description">描述 <span>选填</span></Label><Input id="snippet-description" placeholder="说明片段的用途" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
            <div className="snippet-field snippet-field-wide"><Label htmlFor="snippet-tags">标签 <span>用逗号分隔</span></Label><Input id="snippet-tags" placeholder="例如：Linux, 运维" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} /></div>
          </div>
          <div className="snippet-group snippet-field"><Label htmlFor="snippet-content">命令内容</Label><Textarea id="snippet-content" placeholder="输入命令或脚本…" spellCheck={false} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} /></div>
        </fieldset>
        <div className="snippet-footer"><Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>取消</Button><Button type="submit" disabled={busy}>{busy ? '保存中…' : '保存'}</Button></div>
      </form> : <>
        <div className="snippet-toolbar"><div className="snippet-search"><Search size={16} aria-hidden="true" /><Input aria-label="搜索片段" placeholder="搜索名称、标签或内容…" value={query} onChange={(e) => { setQuery(e.target.value); setDeleteId(null) }} /></div><Button disabled={busy} onClick={() => setDraft({ ...emptyDraft })}><Plus size={16} aria-hidden="true" />新建片段</Button></div>
        <div className="snippet-columns">
          <aside className="snippet-list snippet-group" aria-label="片段列表" aria-busy={loading}>
            <div className="snippet-list-items">
              {loading ? <p className="snippet-empty" role="status">正在读取片段…</p> : loadError ? <div className="snippet-empty" role="alert">片段读取失败<Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>重试</Button></div> : matches.map((s) => <button type="button" key={s.id} disabled={busy} className={cn('snippet-list-item', selected?.id === s.id && 'is-selected')} aria-current={selected?.id === s.id ? 'true' : undefined} onClick={() => { setSelectedId(s.id); setDeleteId(null) }}>
                <SquareTerminal size={16} aria-hidden="true" /><span><span className="snippet-list-name">{s.name}</span><span className="snippet-list-summary">{s.description || s.content.split(/[\r\n]/, 1)[0]}</span></span>
              </button>)}
              {!loading && !loadError && !matches.length && <p className="snippet-empty">暂无匹配片段{!snippets.length && <span>点击「新建片段」保存常用命令。</span>}</p>}
            </div>
            {!loading && !loadError && <p className="snippet-list-count">{query ? `找到 ${matches.length} 个片段` : `共 ${snippets.length} 个片段`}</p>}
          </aside>
          <section className="snippet-detail" aria-label="片段详情">
            {!loading && !loadError && selected ? <>
              <header className="snippet-detail-heading"><h2>{selected.name}</h2><div className="snippet-detail-actions"><Button variant="ghost" disabled={busy} onClick={() => setDraft({ ...selected, tags: selected.tags.join(', ') })}>编辑</Button><Button variant="ghost" className="snippet-delete" disabled={busy} onClick={() => {
                if (deleteId !== selected.id) { setDeleteId(selected.id); return }
                void run(async () => { await snippetApi.delete(selected.id); setSnippets((items) => items.filter((item) => item.id !== selected.id)); setDeleteId(null) })
              }}>{deleteId === selected.id ? '确认删除' : '删除'}</Button></div></header>
              {selected.description && <p className="snippet-description">{selected.description}</p>}
              {!!selected.tags.length && <div className="snippet-tags">{selected.tags.map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div>}
              <div className="snippet-group"><div className="snippet-group-heading"><h3>命令内容</h3><Button variant="ghost" disabled={busy} onClick={() => void run(async () => { await writeClipboardText(selected.content); toast.success('已复制片段') })}>复制</Button></div><pre className="snippet-code" tabIndex={0} aria-label="命令内容">{selected.content}</pre></div>
              <p className="snippet-hint">插入时保留终端已有输入，不附加回车。多行命令会先打开预览。</p>
              <div className="snippet-footer"><Button variant="outline" disabled={busy} onClick={() => setPreview({ snippet: selected, target: snippetTarget() })}>预览与执行</Button><Button disabled={busy} onClick={() => insert(selected)}>插入终端</Button></div>
            </> : <p className="snippet-empty">{loading ? '正在读取片段…' : loadError ? '请重试读取片段' : '选择片段以查看内容'}</p>}
          </section>
        </div>
      </>}
    </DialogContent>
  </Dialog>
}
