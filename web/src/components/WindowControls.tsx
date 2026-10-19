import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface WindowControlsProps {
  maximized: boolean
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
  closeLabel?: string
  className?: string
}

/** Windows/Linux 自绘标题栏按钮；图标尺寸独立于共享 Button 的默认尺寸。 */
export function WindowControls({
  maximized,
  onMinimize,
  onToggleMaximize,
  onClose,
  closeLabel = '关闭',
  className,
}: WindowControlsProps) {
  const maximizeLabel = maximized ? '还原' : '最大化'

  return (
    <div className={cn('titlebar-controls', className)}>
      <Button
        type="button"
        variant="ghost"
        className="tb-btn tb-min"
        title="最小化"
        aria-label="最小化"
        onClick={onMinimize}
      >
        <svg className="size-[10px]" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
          <path d="M0 5.5h10" />
        </svg>
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="tb-btn tb-max"
        title={maximizeLabel}
        aria-label={maximizeLabel}
        onClick={onToggleMaximize}
      >
        <svg className="size-[10px]" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
          {maximized ? (
            <>
              <rect x="0.5" y="3.5" width="6" height="6" rx="1" />
              <path d="M3.5 3V1.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H7" />
            </>
          ) : (
            <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" />
          )}
        </svg>
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="tb-btn tb-close"
        title="关闭"
        aria-label={closeLabel}
        onClick={onClose}
      >
        <svg className="size-[10px]" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
          <path d="m.5.5 9 9m0-9-9 9" />
        </svg>
      </Button>
    </div>
  )
}
