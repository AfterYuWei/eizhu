import type { ReactNode } from 'react'
import { CircleCheck, Info, OctagonX, TriangleAlert, X } from 'lucide-react'

export type MobileInlineNoticeTone = 'success' | 'info' | 'warning' | 'error'

const ICONS = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: OctagonX,
} as const

export function MobileInlineNotice({
  tone,
  title,
  description,
  action,
  onDismiss,
}: {
  tone: MobileInlineNoticeTone
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  onDismiss?: () => void
}) {
  const Icon = ICONS[tone]
  return (
    <div
      className="m-inline-notice"
      data-tone={tone}
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
    >
      <span className="m-inline-notice-icon"><Icon aria-hidden="true" /></span>
      <span className="m-inline-notice-copy">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </span>
      {action && <span className="m-inline-notice-action">{action}</span>}
      {onDismiss && (
        <button type="button" className="m-inline-notice-close" aria-label="关闭提示" onClick={onDismiss}>
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
