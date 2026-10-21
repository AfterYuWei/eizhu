import { DesktopError } from '@eizhu/contracts'

export interface ExitingProcess {
  readonly pid: number | undefined
  once(event: 'exit', listener: (code: number) => void): unknown
  removeListener(event: 'exit', listener: (code: number) => void): unknown
  postMessage(message: unknown): void
  kill(): boolean
}

/** A shutdown acknowledgement is not proof that OS handles have been released. Await exit. */
export function stopProcess(
  child: ExitingProcess,
  deadlines: { graceful: number; forced: number } = { graceful: 5000, forced: 5000 },
): Promise<void> {
  if (!child.pid) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let settled = false
    let forceTimer: NodeJS.Timeout | undefined
    const finish = (error?: DesktopError): void => {
      if (settled) return
      settled = true
      clearTimeout(graceTimer)
      clearTimeout(forceTimer)
      child.removeListener('exit', exited)
      if (error) reject(error)
      else resolve()
    }
    const exited = (): void => finish()
    const failed = (): void =>
      finish(new DesktopError({ code: 'RUNTIME_STOP_FAILED', message: '业务进程未能退出，请重试关闭应用' }))
    const force = (): void => {
      clearTimeout(graceTimer)
      try {
        if (!child.kill()) return failed()
        if (!settled) forceTimer = setTimeout(failed, deadlines.forced)
      } catch {
        failed()
      }
    }
    const graceTimer = setTimeout(force, deadlines.graceful)
    child.once('exit', exited)
    try {
      child.postMessage({ type: 'shutdown' })
    } catch {
      force()
    }
  })
}
