import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import './inline-error.css'

/** 放在对应字段、记录或操作栏内的错误反馈。 */
export function InlineError({ message, className }: { message?: string | null; className?: string }) {
  if (!message) return null
  return (
    <span className={cn('inline-error', className)} role="alert">
      <AlertCircle size={14} aria-hidden="true" />
      <span>{message}</span>
    </span>
  )
}
