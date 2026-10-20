import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { SIDEBAR_PREVIEW_ANIMATION_MS, SIDEBAR_PREVIEW_CLOSE_DELAY_MS } from '@/lib/desktopSidebar'

type Stage = 'closed' | 'opening' | 'open' | 'closing'

/** Hover is temporary and never changes the pinned/split sidebar preference. */
export function useSidebarPreview(collapsed: boolean, disabled: boolean, sidebar: RefObject<HTMLElement | null>) {
  const [stage, setStage] = useState<Stage>('closed')
  const [used, setUsed] = useState(false)
  const current = useRef<Stage>('closed')
  const inside = useRef(false)
  const pointer = useRef<{ target: Element | null; x: number; y: number } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frame = useRef<number | null>(null)
  const update = useCallback((next: Stage) => { current.current = next; setStage(next) }, [])
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }, [])
  const cancelMotion = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    if (exitTimer.current !== null) clearTimeout(exitTimer.current)
    frame.current = null
    exitTimer.current = null
  }, [])
  const reset = useCallback(() => {
    cancelClose()
    cancelMotion()
    inside.current = false
    update('closed')
  }, [cancelClose, cancelMotion, update])
  const show = useCallback(() => {
    if (!collapsed || disabled) return
    cancelClose()
    if (current.current === 'open' || current.current === 'opening') return
    cancelMotion()
    if (current.current === 'closing') { update('open'); return }
    setUsed(true)
    update('opening')
    // Paint the initial translated/transparent overlay before entering.
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => { frame.current = null; update('open') })
    })
  }, [collapsed, disabled, cancelClose, cancelMotion, update])
  const checkInside = useCallback(() => {
    const point = pointer.current
    if (!point) return inside.current
    const target = point.target?.isConnected ? point.target : null
    const rect = sidebar.current?.getBoundingClientRect()
    return Boolean(sidebar.current?.contains(target) || target?.closest('[data-sidebar-popover][data-state="open"]')
      || target?.closest('[data-sidebar-preview-trigger]') && !target.closest('[inert]')
      || rect && rect.width > 0 && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom)
  }, [sidebar])
  const scheduleClose = useCallback(() => {
    if (current.current === 'closed' || current.current === 'closing' || closeTimer.current !== null) return
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      // The overlay can move under a stationary cursor when the trigger hides.
      inside.current = checkInside()
      if (inside.current || document.querySelector('[data-sidebar-popover][data-state="open"]')) return
      cancelMotion()
      const returnFocus = sidebar.current?.contains(document.activeElement)
      update('closing')
      exitTimer.current = setTimeout(() => {
        exitTimer.current = null
        update('closed')
        // Wait until the workspace trigger is visible and no longer inert.
        if (returnFocus) frame.current = requestAnimationFrame(() => {
          frame.current = null
          const trigger = [...document.querySelectorAll<HTMLButtonElement>('[data-sidebar-preview-trigger]')].find((element) => !sidebar.current?.contains(element))
          trigger?.focus({ preventScroll: true })
        })
      }, SIDEBAR_PREVIEW_ANIMATION_MS)
    }, SIDEBAR_PREVIEW_CLOSE_DELAY_MS)
  }, [cancelMotion, checkInside, sidebar, update])

  const present = collapsed && !disabled && stage !== 'closed'
  const resetUsage = useCallback(() => setUsed(false), [])
  useEffect(() => { if (!collapsed || disabled) reset(); if (!collapsed) resetUsage() }, [collapsed, disabled, reset, resetUsage])
  useEffect(() => {
    if (!present) return
    const move = (event: globalThis.PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      pointer.current = { target, x: event.clientX, y: event.clientY }
      inside.current = checkInside()
      if (inside.current) { cancelClose(); if (current.current === 'closing') show() }
      else scheduleClose()
    }
    const menus = new MutationObserver(() => {
      inside.current = checkInside()
      if (document.querySelector('[data-sidebar-popover][data-state="open"]')) cancelClose()
      else if (!inside.current) scheduleClose()
    })
    const blur = () => reset()
    document.addEventListener('pointermove', move, true)
    window.addEventListener('blur', blur)
    menus.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] })
    return () => { document.removeEventListener('pointermove', move, true); window.removeEventListener('blur', blur); menus.disconnect() }
  }, [present, checkInside, show, reset, scheduleClose, cancelClose])
  useEffect(() => () => { cancelClose(); cancelMotion() }, [cancelClose, cancelMotion])

  const enter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch' || event.buttons) return
    pointer.current = { target: event.target instanceof Element ? event.target : null, x: event.clientX, y: event.clientY }
    inside.current = true
    show()
  }
  const leave = (event: PointerEvent<HTMLElement>) => {
    const next = event.relatedTarget instanceof Element ? event.relatedTarget : null
    pointer.current = { target: next, x: event.clientX, y: event.clientY }
    inside.current = Boolean(sidebar.current?.contains(next) || next?.closest('[data-sidebar-popover], [data-sidebar-preview-trigger]'))
    if (!inside.current) scheduleClose()
  }
  return { present, open: present && stage === 'open', interactive: present && stage !== 'closing', instantCollapse: collapsed && used, enter, leave }
}
