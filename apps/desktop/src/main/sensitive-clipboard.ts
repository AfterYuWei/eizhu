/** Owned by main so closing a form or renderer cannot cancel conditional secret cleanup. */
export class SensitiveClipboard {
  private timer?: ReturnType<typeof setTimeout>
  private expected?: string
  private generation = 0
  private clipboard: {
    readText: () => string | Promise<string>
    writeText: (text: string) => void | Promise<void>
  }
  constructor(clipboard: {
    readText: () => string | Promise<string>
    writeText: (text: string) => void | Promise<void>
  }) {
    this.clipboard = clipboard
  }
  async write(text: string, seconds: number): Promise<void> {
    const generation = ++this.generation
    if (this.timer) clearTimeout(this.timer)
    this.expected = undefined
    await this.clipboard.writeText(text)
    if (generation !== this.generation) return
    this.expected = text
    this.timer = setTimeout(() => void this.clear(generation), seconds * 1000)
  }
  private async clear(generation = this.generation): Promise<void> {
    const expected = this.expected
    try {
      if (
        expected !== undefined &&
        (await this.clipboard.readText()) === expected &&
        generation === this.generation
      )
        await this.clipboard.writeText('')
    } catch {
      /* A revoked clipboard permission must never terminate the app or overwrite other content. */
    } finally {
      if (generation === this.generation) {
        this.expected = undefined
        this.timer = undefined
      }
    }
  }
  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    await this.clear()
  }
}
