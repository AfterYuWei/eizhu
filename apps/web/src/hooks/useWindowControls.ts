import { useEffect,useState } from 'react'
import { bridge } from '@/lib/bridge'
import { getPlatformCapabilities,isDesktopRuntime } from '@/lib/platform'
export function isDesktop(): boolean { return isDesktopRuntime() }
export function isMac(): boolean { return getPlatformCapabilities().platform === 'macos' }
export function getPlatform(): string { return isDesktop() ? getPlatformCapabilities().platform : '' }
export function useWindowControls() {
  const desktop = isDesktop(), mac = isMac()
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    if (!desktop || mac) return
    let active = true
    void bridge().window.state().then(state => { if (active) setMaximized(state.maximized) }).catch(() => {})
    const off = bridge().events.on('eizhu-window-state', state => setMaximized(state.maximized))
    return () => { active = false; off() }
  }, [desktop, mac])
  const minimize = () => { if (desktop) void bridge().window.minimize() }
  const toggleMaximize = () => { if (desktop) void bridge().window.toggleMaximize() }
  const close = () => { if (desktop) void bridge().window.close() }
  return { desktop, mac, showControls: desktop && !mac, maximized, minimize, toggleMaximize, close }
}
