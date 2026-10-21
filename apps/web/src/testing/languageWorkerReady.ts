/** Monaco registers language services asynchronously after the first model activates a language. */
export async function languageWorkerReady<T>(
  load: () => Promise<T>,
  notRegistered: string,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = performance.now() + timeoutMs
  for (;;) {
    try {
      return await load()
    } catch (cause) {
      // Only wait for Monaco's known activation state; worker/CSP/module failures remain failures.
      if (cause !== notRegistered) throw cause
      if (performance.now() >= deadline) throw new Error('语言服务初始化超时', { cause })
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}
