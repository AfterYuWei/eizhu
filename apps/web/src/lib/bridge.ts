import { DesktopError, normalizeCommandError } from '@eizhu/contracts'
import type { Bootstrap, DesktopApi, DesktopEvents } from '@eizhu/contracts'
declare global {
  interface Window {
    eizhu?: DesktopApi
  }
}
let bootstrap: Bootstrap | undefined
const proxies = new WeakMap<object, object>()
function normalizeBridge<T extends object>(value: T): T {
  const cached = proxies.get(value)
  if (cached) return cached as T
  // contextBridge freezes its objects. Use a separate target so wrapping functions respects Proxy invariants.
  const proxy = new Proxy({} as T, {
    get(_target, key) {
      const member = Reflect.get(value, key)
      if (typeof member === 'function')
        return (...args: unknown[]) => {
          try {
            const result = Reflect.apply(member, value, args)
            return result && typeof result.then === 'function'
              ? result.catch((cause: unknown) => {
                  throw normalizeCommandError(cause)
                })
              : result
          } catch (cause) {
            throw normalizeCommandError(cause)
          }
        }
      return member && typeof member === 'object' ? normalizeBridge(member) : member
    },
  })
  proxies.set(value, proxy)
  return proxy
}
export function bridge(): DesktopApi {
  if (typeof window === 'undefined' || !window.eizhu)
    throw new DesktopError({
      code: 'DESKTOP_UNAVAILABLE',
      message: '此功能需要 eizhu 桌面客户端，请使用 npm run desktop:dev 启动',
    })
  return normalizeBridge(window.eizhu)
}
export async function initializeBridge(): Promise<Bootstrap | undefined> {
  bootstrap = window.eizhu ? await bridge().app.bootstrap() : undefined
  return bootstrap
}
export function desktopBootstrap(): Bootstrap | undefined {
  return bootstrap
}
export async function listen<K extends keyof DesktopEvents>(
  name: K,
  callback: (event: { payload: DesktopEvents[K] }) => void,
): Promise<() => void> {
  if (!window.eizhu) return () => undefined
  return window.eizhu.events.on(name, (payload) => callback({ payload }))
}
