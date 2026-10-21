import { useLayoutEffect } from 'react'
import { bridge } from '@/lib/bridge'
import { isDesktopRuntime } from '@/lib/platform'

/** Signal after the DOM commit; hidden windows may pause animation frames and timers. */
export function MainWindowReady() {
  useLayoutEffect(() => {
    if (isDesktopRuntime()) void bridge().app.ready()
  }, [])
  return null
}
