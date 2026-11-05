import { Children, isValidElement, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, ChevronRight } from 'lucide-react'
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
  failed: '失败',
}
export function AiMessage({
  message,
  target,
  continuation = false,
  onError,
}: {
  message: AiConversation['messages'][number]
  target?: AiTarget
  continuation?: boolean
  onError: (message: string) => void
}) {
  if (message.role === 'user')
    return (
      <article className="ai-message is-user">
        <div className="ai-message-text">{message.text}</div>
      </article>
    )
  const call = message.tool
  return (
    <article className={'ai-message is-assistant' + (continuation ? ' is-continuation' : '')}>
      {!continuation && (
        <div className="ai-message-role">
          <span className="ai-avatar" role="img" aria-label="AI头像">
            <AiIcon size={18} />
          </span>
          <span>AI</span>
        </div>
      )}
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
                <div className="ai-table-scroll" role="region" aria-label="表格，可横向滚动" tabIndex={0}>
                  <table>{children}</table>
                </div>
              ),
            }}
          >
            {message.text}
          </Markdown>
        </div>
      )}
      {call && (
        <details className="ai-command" data-state={call.state}>
          <summary className="ai-command-summary">
            <ChevronRight size={14} aria-hidden="true" />
            <span className="ai-command-purpose">{call.name}</span>
            <span className="ai-command-status">{states[call.state]}</span>
          </summary>
          {target && (
            <div className="ai-command-target">
              {target.username}@{target.host}:{target.port}
            </div>
          )}
          <AiCodeBlock label="操作" content={call.preview} wrap onError={onError} />
          {call.result !== undefined && (
            <AiCodeBlock
              label="结果"
              content={typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
              wrap
              onError={onError}
            />
          )}
          {call.error && <p className="ai-command-notice">{call.error}</p>}
        </details>
      )}
      {message.text && (
        <div className="ai-reply-actions">
          <ShellIconButton
            label="复制回复"
            onClick={() =>
              void writeClipboardText(message.text).catch((e) =>
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
