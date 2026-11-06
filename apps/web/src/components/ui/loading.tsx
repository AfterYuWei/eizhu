import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import './loading.css'

/** 无总量可用时使用不定进度，不显示虚构的完成百分比。 */
export function LoadingBar({ label }: { label: string }) {
  return <div className="loading-bar" role="progressbar" aria-label={label}>
    <span />
  </div>
}

/** 页面、列表与局部内容共用的加载状态；提示仅向辅助技术提供。 */
export function Loading({ className, inline = false }: { className?: string; inline?: boolean }) {
  return (
    <span
      role="status"
      className={cn(
        'text-muted-foreground',
        inline ? 'inline-flex shrink-0 items-center justify-center align-middle' : 'flex h-full min-h-20 w-full flex-1 items-center justify-center',
        className,
      )}
    >
      <LoaderCircle size={inline ? 16 : 20} className="shrink-0 motion-safe:animate-spin" aria-hidden="true" />
      <span className="sr-only">加载中</span>
    </span>
  )
}
