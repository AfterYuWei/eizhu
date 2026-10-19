import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_DESKTOP_SIDEBAR_WIDTH, MIN_DESKTOP_SIDEBAR_WIDTH, MAX_DESKTOP_SIDEBAR_WIDTH,
  SIDEBAR_COLLAPSE_DELAY_MS, SIDEBAR_REOPEN_DRAG_DISTANCE,
} from '@/lib/desktopSidebar'
import { cn } from '@/lib/utils'

interface Drag {
  pointerId: number
  originX: number
  originWidth: number
  lastX: number
  leftmostX: number
  phase: 'resizing' | 'pending' | 'collapsed' | 'catching-up'
}

/** Stays mounted while collapsed so the same captured pointer can reopen it. */
export function SidebarResizeHandle({ width, collapsed, disabled = false, measureWidth, onResize, onCollapse, onExpand }: {
  width: number
  collapsed: boolean
  disabled?: boolean
  measureWidth?: () => number
  onResize: (width: number) => void
  onCollapse: () => void
  onExpand: () => void
}) {
  const handle = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState(false)
  const cancelCollapse = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    setPending(false)
  }, [])
  const finish = useCallback((keepPending = false) => {
    const active = drag.current
    drag.current = null
    setDragging(false)
    if (!keepPending) cancelCollapse()
    if (active && handle.current?.hasPointerCapture(active.pointerId)) handle.current.releasePointerCapture(active.pointerId)
  }, [cancelCollapse])

  useEffect(() => {
    const active = drag.current
    if (disabled || (active && (active.phase === 'collapsed') !== collapsed)) finish()
    else if (collapsed && !active) cancelCollapse()
  }, [collapsed, disabled, finish, cancelCollapse])
  useEffect(() => {
    const cancel = () => finish()
    const element = handle.current
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('blur', cancel)
      if (timer.current !== null) clearTimeout(timer.current)
      const active = drag.current
      drag.current = null
      if (active && element?.hasPointerCapture(active.pointerId)) element.releasePointerCapture(active.pointerId)
    }
  }, [finish])

  return <div ref={handle} role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical"
    aria-hidden={collapsed || undefined} tabIndex={collapsed || disabled ? -1 : 0}
    aria-valuenow={Math.round(width)} aria-valuemin={MIN_DESKTOP_SIDEBAR_WIDTH} aria-valuemax={MAX_DESKTOP_SIDEBAR_WIDTH}
    className={cn('shell-resizer is-vertical shell-sidebar-resizer', dragging && 'is-dragging', pending && 'is-collapse-pending', collapsed && 'is-collapsed')}
    onPointerDown={(event) => {
      if (event.button !== 0 || collapsed || disabled || drag.current) return
      event.preventDefault()
      cancelCollapse()
      const startingWidth = Math.max(MIN_DESKTOP_SIDEBAR_WIDTH, Math.min(MAX_DESKTOP_SIDEBAR_WIDTH, measureWidth?.() || width))
      onResize(startingWidth)
      drag.current = { pointerId: event.pointerId, originX: event.clientX, originWidth: startingWidth, lastX: event.clientX, leftmostX: event.clientX, phase: 'resizing' }
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
    }}
    onPointerMove={(event) => {
      const active = drag.current
      if (!active || active.pointerId !== event.pointerId) return
      active.lastX = event.clientX
      if (active.phase === 'collapsed') {
        active.leftmostX = Math.min(active.leftmostX, event.clientX)
        if (event.clientX - active.leftmostX >= SIDEBAR_REOPEN_DRAG_DISTANCE) {
          // Anchor to the restored edge, preserving the original grab offset.
          // The cursor must catch up before it can resize the sidebar again.
          active.phase = 'catching-up'
          active.originX += DEFAULT_DESKTOP_SIDEBAR_WIDTH - active.originWidth
          active.originWidth = DEFAULT_DESKTOP_SIDEBAR_WIDTH
          onExpand()
        } else return
      }
      if (active.phase === 'catching-up') {
        if (event.clientX < active.originX) return
        active.phase = 'resizing'
      }
      const next = active.originWidth + event.clientX - active.originX
      onResize(Math.max(MIN_DESKTOP_SIDEBAR_WIDTH, Math.min(MAX_DESKTOP_SIDEBAR_WIDTH, next)))
      if (next <= MIN_DESKTOP_SIDEBAR_WIDTH) {
        active.phase = 'pending'
        if (timer.current !== null) return
        setPending(true)
        timer.current = setTimeout(() => {
          timer.current = null
          const current = drag.current
          if (current) {
            current.phase = 'collapsed'
            current.leftmostX = current.lastX
          }
          setPending(false)
          onCollapse()
        }, SIDEBAR_COLLAPSE_DELAY_MS)
      } else {
        active.phase = 'resizing'
        cancelCollapse()
      }
    }}
    onPointerUp={(event) => {
      if (drag.current?.pointerId === event.pointerId) finish(drag.current.phase === 'pending')
    }}
    onPointerCancel={(event) => { if (drag.current?.pointerId === event.pointerId) finish() }}
    onLostPointerCapture={(event) => { if (drag.current?.pointerId === event.pointerId) finish() }}
    onKeyDown={(event) => {
      if (collapsed || disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return
      event.preventDefault()
      finish()
      if (event.key === 'Escape') return
      if (event.key === 'ArrowLeft' && width <= MIN_DESKTOP_SIDEBAR_WIDTH) onCollapse()
      else onResize(event.key === 'Home' ? MIN_DESKTOP_SIDEBAR_WIDTH : event.key === 'End' ? MAX_DESKTOP_SIDEBAR_WIDTH
        : Math.max(MIN_DESKTOP_SIDEBAR_WIDTH, Math.min(MAX_DESKTOP_SIDEBAR_WIDTH, width + (event.key === 'ArrowLeft' ? -8 : 8))))
    }} />
}
