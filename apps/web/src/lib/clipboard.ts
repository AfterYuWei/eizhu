import { bridge } from './bridge'

export async function writeClipboardText(text: string): Promise<void> { await bridge().clipboard.write({ text }) }
export async function readClipboardText(): Promise<string> { return bridge().clipboard.read() }

export type ClipboardCountdown = (remainingSeconds: number, cleared: boolean) => void

export async function copySensitiveText(
  text: string,
  onCountdown: ClipboardCountdown,
  clearAfterSeconds = 30,
): Promise<void> {
  await writeClipboardText(text)
  let remaining = Math.max(1, Math.floor(clearAfterSeconds))
  onCountdown(remaining, false)
  const timer = globalThis.setInterval(() => {
    remaining -= 1
    if (remaining > 0) {
      onCountdown(remaining, false)
      return
    }
    globalThis.clearInterval(timer)
    void clearIfUnchanged(text).then((cleared) => onCountdown(0, cleared))
  }, 1000)
}

async function clearIfUnchanged(expected: string): Promise<boolean> {
  try {
    if (await readClipboardText() !== expected) return false
    await writeClipboardText('')
    return true
  } catch {
    // Never overwrite clipboard content when equality cannot be established.
    return false
  }
}
