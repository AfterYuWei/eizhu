import { useRef, useState, type ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function ShellIconButton({ label, className, showTooltip = true, ...props }: ComponentProps<typeof Button> & { label: string; showTooltip?: boolean }) {
  const button = <Button type="button" variant="ghost" size="icon-sm" {...props} className={cn('shell-icon-button', className)} aria-label={label} />
  if (!showTooltip) return button
  return <Tooltip>
    <TooltipTrigger asChild>{button}</TooltipTrigger>
    <TooltipContent sideOffset={6}>{label}</TooltipContent>
  </Tooltip>
}

export function ShellResizeHandle({ label, orientation = 'vertical', value, min, max, step = 8, onChange, pixelsPerUnit = 1, reverse = false, className }: {
  label: string
  orientation?: 'vertical' | 'horizontal'
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  pixelsPerUnit?: number
  reverse?: boolean
  className?: string
}) {
  const origin = useRef({ pointer: 0, value: 0 })
  const [dragging, setDragging] = useState(false)
  const vertical = orientation === 'vertical'
  const change = (next: number) => onChange(Math.max(min, Math.min(max, next)))
  return <div role="separator" tabIndex={0} aria-label={label} aria-orientation={orientation}
    aria-valuenow={Math.round(value * 100) / 100} aria-valuemin={min} aria-valuemax={max}
    className={cn('shell-resizer', vertical ? 'is-vertical' : 'is-horizontal', dragging && 'is-dragging', className)}
    onPointerDown={(event) => {
      if (event.button !== 0) return
      event.preventDefault()
      origin.current = { pointer: vertical ? event.clientX : event.clientY, value }
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
    }}
    onPointerMove={(event) => {
      if (!dragging) return
      const delta = (vertical ? event.clientX : event.clientY) - origin.current.pointer
      change(origin.current.value + delta / Math.max(pixelsPerUnit, 0.001) * (reverse ? -1 : 1))
    }}
    onPointerUp={(event) => {
      setDragging(false)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={() => setDragging(false)}
    onLostPointerCapture={() => setDragging(false)}
    onKeyDown={(event) => {
      const decrement = vertical ? 'ArrowLeft' : 'ArrowUp'
      const increment = vertical ? 'ArrowRight' : 'ArrowDown'
      if (event.key !== decrement && event.key !== increment && event.key !== 'Home' && event.key !== 'End') return
      event.preventDefault()
      if (event.key === 'Home') change(min)
      else if (event.key === 'End') change(max)
      else change(value + (event.key === decrement ? -step : step) * (reverse ? -1 : 1))
    }} />
}
