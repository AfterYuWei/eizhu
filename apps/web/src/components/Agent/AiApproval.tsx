import type { AiToolCall, AiTarget } from '@eizhu/contracts'
import { Button } from '@/components/ui/button'
import { AiCodeBlock } from './AiCodeBlock'
export function AiApproval({
  call,
  target,
  disabled,
  onDecide,
  onError,
}: {
  call: AiToolCall
  target?: AiTarget
  disabled: boolean
  onDecide: (decision: 'once' | 'conversation' | 'reject') => void
  onError: (message: string) => void
}) {
  return (
    <section className="ai-approval" aria-label="工具操作审批">
      <div className="ai-approval-heading">允许此操作？</div>
      <div className="ai-approval-content">
        <p className="ai-approval-purpose">{call.name}</p>
        {target && (
          <div className="ai-command-target">
            {target.username}@{target.host}:{target.port}
          </div>
        )}
        <AiCodeBlock
          label="操作预览"
          language={call.name.startsWith('file_') ? 'Diff' : 'Shell'}
          content={call.preview}
          wrap
          onError={onError}
        />
      </div>
      <div className="ai-approval-footer">
        <div className="ai-inline-actions">
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onDecide('reject')}>
            拒绝
          </Button>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onDecide('conversation')}>
            对话内允许此工具
          </Button>
          <Button size="sm" disabled={disabled} onClick={() => onDecide('once')}>
            允许本次
          </Button>
        </div>
      </div>
    </section>
  )
}
