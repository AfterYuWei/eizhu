/** Own resources in reverse acquisition order. Closing twice shares the same completion. */
export class ResourceScope {
  readonly controller = new AbortController()
  private disposers: Array<() => void | Promise<void>> = []
  private closing?: Promise<void>
  own(dispose: () => void | Promise<void>): void {
    if (this.controller.signal.aborted) throw new Error('Scope is closed')
    this.disposers.push(dispose)
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.controller.abort()
    this.closing = (async () => {
      const errors: unknown[] = []
      for (const dispose of this.disposers.splice(0).reverse()) {
        try {
          await dispose()
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length) throw new AggregateError(errors, 'Resource cleanup failed')
    })()
    return this.closing
  }
}
