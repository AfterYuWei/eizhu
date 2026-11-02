import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import { ArrowUpRight, Check, ChevronRight, Copy, RefreshCw } from 'lucide-react'
import type { AiConversation, AiTarget } from '@eizhu/contracts'
import { bridge } from '@/lib/bridge'
import { AiIcon } from '@/lib/serverIcons'
import { writeClipboardText } from '@/lib/clipboard'
import { ShellIconButton } from '@/components/Layout/ShellControls'
import { Button } from '@/components/ui/button'

const states = {
  pending: '等待确认',
  running: '执行中',
  completed: '已结束',
  unknown: '结果未知',
  rejected: '已拒绝',
  expired: '已失效',
}
type Message = AiConversation['messages'][number]

function AiCodeBlock({
  label,
  language,
  content,
  onError,
}: {
  label: string
  language?: string
  content: string
  onError: (message: string) => void
}) {
  const [copiedContent, setCopiedContent] = useState<string | null>(null)
  const copied = copiedContent === content
  const lines = content.replace(/\n$/, '').split('\n')
  useEffect(() => {
    if (copiedContent === null) return
    const timer = setTimeout(() => setCopiedContent(null), 1500)
    return () => clearTimeout(timer)
  }, [copiedContent])
  return (
    <div className="ai-code-block" aria-label={`${label}代码块`}>
      <div className="ai-code-block-heading">
        <span>{language || label}</span>
        <div className="ai-inline-actions">
          {copied && <span role="status">已复制</span>}
          <ShellIconButton
            label={`复制${label}`}
            onClick={() => {
              void writeClipboardText(content).then(
                () => setCopiedContent(content),
                (error) => onError(error instanceof Error ? error.message : '复制失败，请重试'),
              )
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </ShellIconButton>
        </div>
      </div>
      <pre>
        <code>
          {lines.map((line, index) => (
            <span className="ai-code-line" key={index}>
              {lines.length > 1 && (
                <span className="ai-code-number" aria-hidden="true">
                  {index + 1}
                </span>
              )}
              <span>
                {language
                  ? line
                      .split(
                        /(\b(?:SELECT|FROM|WHERE|AND|OR|AS|GROUP|ORDER|BY|COUNT|DATE|JOIN|ON|LIMIT|INSERT|UPDATE|DELETE|SET|sudo|systemctl|docker|git|cd|cat|printf|echo|ls)\b)/gi,
                      )
                      .map((part, i) => (
                        <span key={i} className={i % 2 ? 'ai-code-keyword' : undefined}>
                          {part}
                        </span>
                      ))
                  : line || ' '}
              </span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

export function AiMessage({
  message,
  target,
  busy,
  onError,
  onAsk,
  onContinue,
  onDecide,
  onTimeout,
}: {
  message: Message
  target: AiTarget
  busy: boolean
  onError: (message: string) => void
  onAsk: () => void
  onContinue: (text: string) => void
  onDecide: (id: string, accepted: boolean) => void
  onTimeout: (id: string, seconds: number) => void
}) {
  const p = message.proposal
  const reply = [
    message.text,
    ...(p ? [`\n\n\`\`\`sh\n${p.command}\n\`\`\``, p.result?.stdout ?? '', p.result?.stderr ?? ''] : []),
  ]
    .filter(Boolean)
    .join('\n')
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
  return (
    <article className="ai-message is-assistant">
      <div className="ai-message-role">
        <span className="ai-avatar" role="img" aria-label="AI 头像">
          <AiIcon size={18} />
        </span>
        <span>AI</span>
      </div>
      {p && (
        <details className="ai-task-details">
          <summary>
            {p.result ? `执行耗时 ${(p.result.elapsedMs / 1000).toFixed(1)}s` : states[p.state]}
            <ChevronRight size={12} />
          </summary>
          <p>
            {target.username}@{target.host}:{target.port} · {p.cwd}
          </p>
          <p>{p.purpose}</p>
          <p>影响：{p.impact}</p>
        </details>
      )}
      {message.text && (
        <div className="ai-markdown">
          <Markdown
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
            }}
          >
            {message.text}
          </Markdown>
        </div>
      )}
      {p && (
        <div className="ai-command" data-state={p.state}>
          <p className="ai-command-purpose">{p.purpose}</p>
          <div className="ai-command-target">
            {target.username}@{target.host}:{target.port} · {p.cwd}
          </div>
          <AiCodeBlock label="命令" language="Shell" content={p.command} onError={onError} />
          <p className="ai-impact">影响：{p.impact}</p>
          {p.state === 'pending' && (
            <div className="ai-approval">
              <label className="ai-timeout">
                超时{' '}
                <input
                  type="number"
                  min={1}
                  max={600}
                  defaultValue={p.timeoutSeconds}
                  disabled={busy}
                  onBlur={(event) => {
                    const seconds = Number(event.target.value)
                    if (
                      Number.isInteger(seconds) &&
                      seconds >= 1 &&
                      seconds <= 600 &&
                      seconds !== p.timeoutSeconds
                    )
                      onTimeout(p.id, seconds)
                    else event.target.value = String(p.timeoutSeconds)
                  }}
                />{' '}
                秒
              </label>
              <div className="ai-inline-actions">
                <Button size="sm" disabled={busy} onClick={() => onDecide(p.id, true)}>
                  执行此命令
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(p.id, false)}>
                  拒绝
                </Button>
              </div>
            </div>
          )}
          {p.result && (
            <div className="ai-result">
              {p.result.stdout && (
                <AiCodeBlock label="标准输出" content={p.result.stdout} onError={onError} />
              )}
              {p.result.stderr && (
                <AiCodeBlock label="错误输出" content={p.result.stderr} onError={onError} />
              )}
              <p className="ai-result-meta">
                {p.result.exitCode === null ? '退出码未知' : `退出码 ${p.result.exitCode}`} ·{' '}
                {(p.result.elapsedMs / 1000).toFixed(1)} 秒{p.result.truncated ? ' · 输出已截断' : ''}
              </p>
              {p.result.message && <p>{p.result.message}</p>}
            </div>
          )}
        </div>
      )}
      {message.text && (
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
