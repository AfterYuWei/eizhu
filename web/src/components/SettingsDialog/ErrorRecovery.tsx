import { recoveryFor } from '@/lib/syncExperience'
import { runDesktopAction } from '@/lib/desktopActions'
import { Button } from '@/components/ui/button'

export function ErrorRecovery({ code, status, onRetry, unlockId = 'sync-password' }: { code?: string; status?: string; onRetry: () => void; unlockId?: string }) {
  const recovery = recoveryFor(code, status)
  return <div className="space-y-2 text-xs"><p className="text-muted-foreground">{recovery.explanation}</p><Button size="sm" variant="outline" onClick={() => {
    if (recovery.kind === 'account' || recovery.kind === 'quota') runDesktopAction('account-settings')
    else if (recovery.kind === 'unlock') document.getElementById(unlockId)?.focus()
    else onRetry()
  }}>{recovery.label}</Button></div>
}
