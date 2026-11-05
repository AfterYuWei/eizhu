import { Children, isValidElement, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowUpRight, ChevronRight, Copy, RefreshCw } from 'lucide-react'
import type { AiConversation, AiTarget } from '@eizhu/contracts'
import { bridge } from '@/lib/bridge'
import { AiIcon } from '@/lib/serverIcons'
import { writeClipboardText } from '@/lib/clipboard'
import { ShellIconButton } from '@/components/Layout/ShellControls'
import { AiCodeBlock } from './AiCodeBlock'

const states = {
  pending: '等待确认',
  running: '执行中',
  completed: '已完成',
  unknown: '结果未知',
  rejected: '已拒绝',
  expired: '已失效',
}
type Message = AiConversation['messages'][number]

export function AiMessage({
  message,
  target,
  continuation = false,
  busy,
  onError,
  onAsk,
  onContinue,
}: {
  message: Message
  target: AiTarget
  continuation?: boolean
  busy: boolean
  onError: (message: string) => void
  onAsk: () => void
  onContinue: (text: string) => void
}) {
  const p = message.proposal
  const reply = message.text
  const copyReply = () => {
    void writeClipboardText(reply).catch((error) =>
      onError(error instanceof Error ? error.message : '复制失败，请重试'),
    )
  }
  if (message.role === 'user')
    return (
      <article className="ai-message is-user">
        <div className="ai-message-text">{message.text}</div>
      </article>
    )
  const content = message.text && (
    <div className="ai-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={['img']}
        urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : '')}
        components={{
          pre: ({ children }) => {
            const code = Children.toArray(children)[0]
            if (
              !isValidElement<{ children?: ReactNode; className?: string }>(code) ||
              typeof code.props.children !== 'string'
            )
              return <pre>{children}</pre>
            const language = code.props.className?.match(/language-([^\s]+)/)?.[1]
            return (
              <AiCodeBlock
                label="代码"
                language={language?.toUpperCase()}
                content={code.props.children}
                onError={onError}
              />
            )
          },
          a: ({ href, children }) =>
            href ? (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault()
                  void bridge()
                    .system.openExternal({ url: href })
                    .catch((error) => onError(error instanceof Error ? error.message : '无法打开链接'))
                }}
              >
                {children}
              </a>
            ) : (
              <span className="ai-reference">{children}</span>
            ),
          hr: () => null,
          table: ({ children }) => (
            <div className="ai-table-scroll" role="region" aria-label="表格，可横向滚动" tabIndex={0}>
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {message.text}
      </Markdown>
    </div>
  )
  const status =
    p?.state === 'completed' && p.result
      ? p.result.exitCode === 0
        ? states.completed
        : p.result.exitCode === null
          ? '退出码未知'
          : `退出码 ${p.result.exitCode}`
      : p
        ? states[p.state]
        : ''
  return (
    <article className={`ai-message is-assistant${continuation ? ' is-continuation' : ''}`}>
      {!continuation && (
        <div className="ai-message-role">
          <span className="ai-avatar" role="img" aria-label="AI 头像">
            <AiIcon size={18} />
          </span>
          <span>AI</span>
        </div>
      )}
      {content}
      {p && (
        <details className="ai-command" data-state={p.state}>
          <summary className="ai-command-summary">
            <ChevronRight size={14} aria-hidden="true" />
            <span className="ai-command-purpose">{p.purpose}</span>
            <span
              className="ai-command-status"
              data-attention={p.state === 'unknown' || (p.state === 'completed' && p.result?.exitCode !== 0)}
            >
              {status}
              {p.result && p.state !== 'running' && ` · ${(p.result.elapsedMs / 1000).toFixed(1)} 秒`}
              {p.result?.truncated && ' · 结果已截断'}
            </span>
          </summary>
          <div className="ai-command-target">
            {target.username}@{target.host}:{target.port} · {p.cwd}
          </div>
          <AiCodeBlock label="命令" language="Shell" content={p.command} wrap onError={onError} />
          <p className="ai-impact">影响：{p.impact}</p>
        </details>
      )}
      {p?.state === 'unknown' && (
        <p className="ai-command-notice">{p.result?.message || '执行结果未知，请在当前终端核查。'}</p>
      )}
      {message.text && !p && (
        <div className="ai-reply-actions" aria-label="回复操作">
          <ShellIconButton label="复制回复" onClick={copyReply}>
            <Copy size={14} />
          </ShellIconButton>
          <ShellIconButton label="重新提问" disabled={busy} onClick={onAsk}>
            <RefreshCw size={14} />
          </ShellIconButton>
          <ShellIconButton label="在新对话中继续" disabled={busy} onClick={() => onContinue(reply)}>
            <ArrowUpRight size={14} />
          </ShellIconButton>
        </div>
      )}
    </article>
  )
}
