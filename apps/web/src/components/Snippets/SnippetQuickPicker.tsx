import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Search, SquareTerminal } from 'lucide-react'
import { toast } from 'sonner'
import { snippetApi } from '@/api/snippet'
import type { Snippet } from '@/types/snippet'
import { useSessionStore } from '@/store/session'
import { useWorkspaceViewStore } from '@/store/workspaceView'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { insertSnippet, multilineSnippet, type SnippetTarget } from '@/lib/snippetInsertion'
import { findQuickSnippets, recentSnippetIds, recordSnippetUse, suppressHeldSnippetEnter } from '@/lib/snippetQuickAccess'
import { writeClipboardText } from '@/lib/clipboard'
import { focusActiveTerminal } from '@/lib/desktopActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { SnippetPreview } from './SnippetPreview'
import { useSnippetTarget } from './useSnippetTarget'
import '@/styles/snippets.css'

interface Props {
  target: SnippetTarget | null
  onClose: () => void
  onManage: () => void
}

export function SnippetQuickPicker({ target, onClose, onManage }: Props) {
  const [generation] = useState(workspaceGeneration)
  const [targetLabel] = useState(() => target
    ? useSessionStore.getState().tabs.find((tab) => tab.id === target.tabId)?.profileName ?? '终端已关闭' : '未选择终端')
  const [recent] = useState(recentSnippetIds)
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<Snippet | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [copying, setCopying] = useState(false)
  const { error: targetError, validate } = useSnippetTarget(target)
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const previewContainer = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const committed = useRef(false)
  const handingOff = useRef(false)
  const composing = useRef(false)
  const copyPending = useRef(false)
  const alive = useRef(true)
  const listId = useId()
  const matches = useMemo(() => findQuickSnippets(snippets, query, recent), [snippets, query, recent])
  const selectedIndex = Math.max(0, matches.findIndex((snippet) => snippet.id === selectedId))
  const selected = matches[selectedIndex]

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(false)
    setSnippets([])
    void Promise.resolve().then(() => snippetApi.list()).then((items) => {
      if (active && generation === workspaceGeneration()) setSnippets(items)
    }).catch(() => {
      if (active && generation === workspaceGeneration()) setLoadError(true)
    }).finally(() => {
      if (active && generation === workspaceGeneration()) setLoading(false)
    })
    return () => { active = false }
  }, [attempt, generation])
  useEffect(() => {
    results.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [selected?.id, matches])
  useEffect(() => {
    if (preview) previewContainer.current?.focus()
    else input.current?.focus()
  }, [preview])

  useEffect(() => {const refresh=()=>setAttempt(value=>value+1);window.addEventListener('eizhu-items-changed',refresh);return()=>window.removeEventListener('eizhu-items-changed',refresh)},[])
  const copy = async (snippet: Snippet) => {
    if (copyPending.current || generation !== workspaceGeneration()) return
    copyPending.current = true
    setCopying(true)
    try {
      await writeClipboardText(snippet.content)
      if (alive.current && generation === workspaceGeneration()) toast.success('已复制片段')
    } catch (error) {
      if (alive.current && generation === workspaceGeneration()) toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      copyPending.current = false
      if (alive.current && generation === workspaceGeneration()) setCopying(false)
    }
  }
  const insert = (snippet: Snippet) => {
    if (committed.current || generation !== workspaceGeneration()) return
    const issue = validate()
    if (issue || !target) { toast.error(issue ?? '请先选择已连接的终端'); return }
    try {
      insertSnippet(target, snippet.content)
      committed.current = true
      recordSnippetUse(snippet.id)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }
  const choose = (snippet?: Snippet) => {
    if (!snippet || loading || loadError || committed.current) return
    if (multilineSnippet(snippet.content)) setPreview(snippet)
    else insert(snippet)
  }

  return <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
    <DialogContent showCloseButton={false} className="pal shell-palette snippet-quick-picker translate-y-0 gap-0 p-0"
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        returnFocus.current = document.activeElement as HTMLElement | null
        input.current?.focus()
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        if (handingOff.current || generation !== workspaceGeneration() || document.querySelector('[role="dialog"][data-state="open"]')) return
        if (committed.current || useWorkspaceViewStore.getState().activePage === 'terminal') focusActiveTerminal()
        else if (returnFocus.current?.isConnected) returnFocus.current.focus()
      }}
      onEscapeKeyDown={(event) => {
        if (composing.current || event.isComposing) { event.preventDefault(); return }
        if (preview) { event.preventDefault(); setPreview(null) }
      }}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Enter' || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.repeat) { event.preventDefault(); event.stopPropagation() }
        else suppressHeldSnippetEnter()
      }}
      onKeyDown={(event) => event.stopPropagation()}>
      <DialogTitle className="sr-only">快速调用片段</DialogTitle>
      <DialogDescription className="sr-only">搜索并选择命令片段，回车只插入，多行先预览。</DialogDescription>
      {preview ? <div ref={previewContainer} tabIndex={-1} className="snippet-quick-preview">
        <SnippetPreview snippet={preview} target={target} targetError={targetError} busy={copying}
          onBack={() => setPreview(null)} onCopy={() => void copy(preview)} onInsert={() => insert(preview)} />
      </div> : <>
        <div className="pal-inp-wrap"><Search size={17} /><Input ref={input} className="pal-inp focus-visible:ring-0"
          placeholder="搜索名称、标签或命令…" aria-label="搜索命令片段" role="combobox"
          aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={selected ? `${listId}-${selectedIndex}` : undefined}
          value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(null) }}
          onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
          onKeyDown={(event) => {
            if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const index = Math.max(0, Math.min(matches.length - 1, selectedIndex + (event.key === 'ArrowDown' ? 1 : -1)))
              setSelectedId(matches[index]?.id ?? null)
            }
            if (event.key === 'Enter') { event.preventDefault(); choose(selected) }
          }} /></div>
        <div className="snippet-quick-target">
          <span>目标：{targetLabel}</span>
          <span>{query.trim() ? '名称匹配优先' : recent.length ? '最近使用优先' : '按名称排列'}</span>
        </div>
        {targetError && <p className="snippet-quick-notice" role="status">{targetError}</p>}
        <div className="pal-results" ref={results} id={listId} role="listbox" aria-label="命令片段搜索结果" aria-busy={loading}>
          {matches.map((snippet, index) => <Button key={snippet.id} id={`${listId}-${index}`} variant="ghost"
            className={`pal-item ${index === selectedIndex ? 'sel' : ''}`} role="option" aria-selected={index === selectedIndex}
            aria-disabled={!!targetError && !multilineSnippet(snippet.content)} tabIndex={-1}
            onPointerMove={() => setSelectedId(snippet.id)} onClick={() => choose(snippet)}>
            <span className="pal-item-icon"><SquareTerminal size={16} /></span>
            <span className="pal-item-label">
              <span className="snippet-quick-name">{snippet.name}</span>
              <small className="snippet-quick-command">{snippet.content.split(/[\r\n]/, 1)[0] || '（空首行）'}</small>
              {!!snippet.tags.length && <small className="snippet-quick-tags">{snippet.tags.join(' · ')}</small>}
            </span>
            {multilineSnippet(snippet.content) && <span className="snippet-quick-badge">多行</span>}
          </Button>)}
          {loading && <div className="pal-empty" role="status">正在读取片段…</div>}
          {loadError && <div className="pal-empty" role="alert">片段读取失败，请重试<Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>重试</Button></div>}
          {!loading && !loadError && !matches.length && <div className="pal-empty">{snippets.length ? '暂无匹配片段' : '暂无命令片段，可先前往管理片段新建'}</div>}
        </div>
        <div className="snippet-quick-actions">
          <Button variant="ghost" size="sm" onClick={() => { handingOff.current = true; onManage() }}>管理片段</Button>
          <div>
            <Button variant="outline" size="sm" disabled={!selected || copying} onClick={() => { if (selected) void copy(selected) }}>复制当前片段</Button>
            <Button size="sm" disabled={!selected || (!!targetError && !multilineSnippet(selected.content))}
              onClick={() => choose(selected)}>{selected && multilineSnippet(selected.content) ? '预览' : '插入终端'}</Button>
          </div>
        </div>
        <div className="shell-search-hint"><span>↑ ↓ 选择</span><span>↵ 只插入 · 多行先预览</span><span>Esc 关闭</span></div>
      </>}
    </DialogContent>
  </Dialog>
}
