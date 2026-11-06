import { useSessionStore } from '@/store/session'
import type { Snippet } from '@/types/snippet'
import { multilineSnippet, type SnippetTarget } from '@/lib/snippetInsertion'
import { terminalActions } from '@/lib/terminalActions'
import { Button } from '@/components/ui/button'
import { useSnippetTarget } from './useSnippetTarget'
import '@/styles/snippets.css'

interface Props {
  snippet: Snippet
  target: SnippetTarget | null
  targetError?: string | null
  busy?: boolean
  allowExecute?: boolean
  onBack: () => void
  onCopy: () => void
  onInsert: (execute: boolean) => void
}

export function SnippetPreview({ snippet, target, targetError, busy, allowExecute, onBack, onCopy, onInsert }: Props) {
  const { error, validate } = useSnippetTarget(target)
  const tabs = useSessionStore((state) => state.tabs)
  const label = target ? tabs.find((tab) => tab.id === target.tabId)?.profileName ?? '终端已关闭' : '未选择终端'
  const issue = targetError ?? error
    ?? (multilineSnippet(snippet.content) && !terminalActions(target?.tabId ?? null)?.safeMultiline()
      ? '当前终端未启用安全的多行粘贴，请使用复制入口' : null)
  return <div className="snippet-preview">
    <div className="snippet-preview-heading"><h2>{snippet.name}</h2><p className="snippet-hint">目标：{label}</p></div>
    <div className="snippet-group"><div className="snippet-group-heading"><h3>命令内容</h3></div><pre className="snippet-code" tabIndex={0} aria-label="命令内容">{snippet.content}</pre></div>
    <p className="snippet-hint">{allowExecute
      ? '插入不会附加回车；执行会在粘贴后提交回车。请检查完整内容和目标终端。'
      : '请检查完整内容和目标终端。插入不会附加回车。'}</p>
    {issue && <p className="snippet-preview-issue" role="status">{issue}</p>}
    <div className="snippet-footer">
      <Button variant="outline" disabled={busy} onClick={onBack}>返回</Button>
      <Button variant="outline" disabled={busy} onClick={onCopy}>复制内容</Button>
      <Button disabled={busy || !!issue} onClick={() => { if (!validate()) onInsert(false) }}>只插入</Button>
      {allowExecute && <Button variant="destructive" disabled={busy || !!issue} onClick={() => { if (!validate()) onInsert(true) }}>明确执行这段命令</Button>}
    </div>
  </div>
}
