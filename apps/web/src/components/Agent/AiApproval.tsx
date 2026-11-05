import { Hand } from 'lucide-react'
import type { AiProposal, AiTarget } from '@eizhu/contracts'
import { Button } from '@/components/ui/button'
import { AiCodeBlock } from './AiCodeBlock'

export function AiApproval({
  proposal,
  target,
  disabled,
  onDecide,
  onError,
}: {
  proposal: AiProposal
  target: AiTarget
  disabled: boolean
  onDecide: (accepted: boolean) => void
  onError: (message: string) => void
}) {
  return (
    <section className="ai-approval" aria-label="命令执行审批">
      <div className="ai-approval-heading">
        <Hand size={15} aria-hidden="true" />
        <span>允许执行此命令？</span>
      </div>
      <div className="ai-approval-content">
        <p className="ai-approval-purpose">{proposal.purpose}</p>
        <div className="ai-command-target">
          {target.username}@{target.host}:{target.port} · {proposal.cwd}
        </div>
        <AiCodeBlock label="命令" language="Shell" content={proposal.command} wrap onError={onError} />
        <p className="ai-impact">影响：{proposal.impact}</p>
      </div>
      <div className="ai-approval-footer">
        <div className="ai-inline-actions">
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onDecide(false)}>
            拒绝
          </Button>
          <Button type="button" size="sm" disabled={disabled} onClick={() => onDecide(true)}>
            允许执行
          </Button>
        </div>
      </div>
    </section>
  )
}
