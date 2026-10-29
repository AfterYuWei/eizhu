import { recoveryFor } from '@/lib/syncExperience';
import { runDesktopAction } from '@/lib/desktopActions';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/ui/inline-error';

export function ErrorRecovery({ code, status, message, onRetry, unlockId = 'sync-password' }: { code?: string; status?: string; message?: string; onRetry: () => void; unlockId?: string }) {
  const recovery = recoveryFor(code, status)
  return <div className="flex min-w-0 items-center gap-4 text-xs"><div className="min-w-0 flex-1"><InlineError message={message}/><p className="text-muted-foreground">{recovery.explanation}</p></div><Button size="sm" variant="outline" onClick={() => {
    if (recovery.kind === 'account' || recovery.kind === 'quota') runDesktopAction('account-settings')
    else if (recovery.kind === 'unlock') document.getElementById(unlockId)?.focus()
    else onRetry()
  }}>{recovery.label}</Button></div>
}
