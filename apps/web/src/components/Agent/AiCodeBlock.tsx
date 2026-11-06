import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { writeClipboardText } from '@/lib/clipboard'
import { ShellIconButton } from '@/components/Layout/ShellControls'

export function AiCodeBlock({
  label,
  language,
  content,
  wrap = false,
  lineNumbers = true,
  onError,
}: {
  label: string
  language?: string
  content: string
  wrap?: boolean
  lineNumbers?: boolean
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
    <div className={`ai-code-block${wrap ? ' is-wrapped' : ''}`} aria-label={`${label}代码块`}>
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
          {lineNumbers
            ? lines.map((line, index) => (
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
              ))
            : content}
        </code>
      </pre>
    </div>
  )
}
