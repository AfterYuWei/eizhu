import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy } from 'lucide-react'
import type { AiConversation, AiTarget } from '@eizhu/contracts'
import { bridge } from '@/lib/bridge'
import { AiIcon } from '@/lib/serverIcons'
import { writeClipboardText } from '@/lib/clipboard'
import { ShellIconButton } from '@/components/Layout/ShellControls'
import { AiCodeBlock } from './AiCodeBlock'
import { AiToolRecords } from './AiToolRecords'
export function AiMessage({
  messages,
  targets = [],
  busy = false,
  startedAt,
  completedAt,
  onError,
}: {
  messages: AiConversation['messages']
  targets?: AiTarget[]
  busy?: boolean
  startedAt?: number
  completedAt?: number
  onError: (message: string) => void
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!busy || startedAt === undefined) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [busy, startedAt])
  const end = busy ? now : completedAt
  const elapsed =
    startedAt !== undefined && end !== undefined
      ? Math.max(0, Math.floor((end - startedAt) / 1000))
      : undefined
  const duration =
    elapsed === undefined
      ? ''
      : [
          elapsed >= 3600 ? `${Math.floor(elapsed / 3600)} 小时` : '',
          elapsed >= 60 ? `${Math.floor(elapsed / 60) % 60} 分` : '',
          `${elapsed % 60} 秒`,
        ]
          .filter(Boolean)
          .join(' ')
  const message = messages[0]
  if (message?.role === 'user')
    return (
      <article className="ai-message is-user">
        <div className="ai-message-text">{message.text}</div>
      </article>
    )
  const reply = messages
    .filter((m) => m.role === 'assistant' && m.text)
    .map((m) => m.text)
    .join('\n\n')
  const parts: Array<AiConversation['messages']> = []
  for (const message of messages) {
    if (!message.text && !message.tool) continue
    const last = parts.at(-1)
    if (message.tool && !message.text && last?.every((m) => m.tool && !m.text)) last.push(message)
    else parts.push([message])
  }
  return (
    <article className="ai-message is-assistant" aria-busy={busy}>
      <div className="ai-message-role">
        <span className="ai-avatar" role="img" aria-label="AI头像">
          <AiIcon size={18} />
        </span>
        <span>AI</span>
        {elapsed !== undefined && (
          <time className="ai-message-elapsed" dateTime={'PT' + elapsed + 'S'}>
            {busy ? '已处理 ' : '耗时 '}
            {duration}
          </time>
        )}
      </div>
      <div className="ai-reply-content">
        {parts.map((part) => {
          const message = part[0]
          const calls = part.flatMap((m) => (m.tool ? [m.tool] : []))
          return (
            <div className="ai-message-part" key={message.id}>
              {message.text && (
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
                        return (
                          <AiCodeBlock
                            label="代码"
                            language={code.props.className?.match(/language-([^\s]+)/)?.[1]}
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
                                .catch((e) => onError(e instanceof Error ? e.message : '无法打开链接'))
                            }}
                          >
                            {children}
                          </a>
                        ) : (
                          <span>{children}</span>
                        ),
                      hr: () => null,
                      table: ({ children }) => (
                        <div
                          className="ai-table-scroll"
                          role="region"
                          aria-label="表格，可横向滚动"
                          tabIndex={0}
                        >
                          <table>{children}</table>
                        </div>
                      ),
                    }}
                  >
                    {message.text}
                  </Markdown>
                </div>
              )}
              {calls.length > 0 && <AiToolRecords calls={calls} targets={targets} onError={onError} />}
            </div>
          )
        })}
      </div>
      {reply && !busy && (
        <div className="ai-reply-actions">
          <ShellIconButton
            label="复制回复"
            onClick={() =>
              void writeClipboardText(reply).catch((e) =>
                onError(e instanceof Error ? e.message : '复制失败'),
              )
            }
          >
            <Copy size={14} />
          </ShellIconButton>
        </div>
      )}
    </article>
  )
}
