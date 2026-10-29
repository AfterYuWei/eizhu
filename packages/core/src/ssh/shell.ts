/* eslint-disable no-control-regex -- OSC sequences are terminal control bytes. */
import { StringDecoder } from 'node:string_decoder'

const READY = Buffer.from('\x1b]1337;eizhuOsc7Ready\x07')

/** Install only the session-local hook supported by the detected login shell. */
export function shellSetupCommand(output: string): string | undefined {
  for (const line of output.trim().split(/\r?\n/).reverse()) {
    const name = line.trim().split('/').pop()?.replace(/^-/, '')
    let hook: string
    if (name === 'bash') {
      hook = String.raw` __eizhu_osc7(){ printf "\033]7;file://%s\007" "$(pwd -P 2>/dev/null)";};case "${'${PROMPT_COMMAND-}'}" in *__eizhu_osc7*) ;; *) PROMPT_COMMAND="__eizhu_osc7${'${PROMPT_COMMAND:+;$PROMPT_COMMAND}'}";;esac;__eizhu_osc7`
    } else if (name === 'zsh') {
      hook = String.raw` __eizhu_osc7(){ printf "\033]7;file://%s\007" "$(pwd -P 2>/dev/null)";};autoload -Uz add-zsh-hook;add-zsh-hook -d precmd __eizhu_osc7 2>/dev/null;add-zsh-hook precmd __eizhu_osc7;__eizhu_osc7`
    } else if (name === 'fish') {
      hook = String.raw` function __eizhu_osc7 --on-variable PWD --on-event fish_prompt;printf '\033]7;file://%s\007' (pwd -P 2>/dev/null);end;__eizhu_osc7`
    } else continue
    return hook + String.raw`;printf "\033]1337;eizhuOsc7Ready\007"`
  }
}

/** Preserve binary terminal output while hiding the setup command's echoed lines. */
export class ShellOutput {
  private decoder = new StringDecoder('utf8')
  private tail = ''
  private command?: Buffer
  private pending = Buffer.alloc(0)

  startBootstrap(command: string): void {
    this.command = Buffer.from(command.trimStart())
  }

  finishBootstrap(): Buffer {
    const data = this.stripEchoes(this.pending)
    this.pending = Buffer.alloc(0)
    this.command = undefined
    return data
  }

  private stripEchoes(input: Buffer): Buffer {
    const lines: Buffer[] = []
    let start = 0
    for (let end = 0; end <= input.length; end++) {
      if (end < input.length && input[end] !== 10) continue
      const line = input.subarray(start, end < input.length ? end + 1 : end)
      if (!this.command || !line.includes(this.command)) lines.push(line)
      start = end + 1
    }
    return Buffer.concat(lines)
  }

  push(input: Buffer): { data: Buffer; cwd?: string; ready: boolean } {
    this.tail = (this.tail + this.decoder.write(input)).slice(-65536)
    let cwd: string | undefined
    let consumed = 0
    for (const match of this.tail.matchAll(/\x1b\]7;file:\/\/[^/\x07\x1b]*([^\x07\x1b]*)(?:\x07|\x1b\\)/g)) {
      try {
        const path = decodeURIComponent(match[1])
        if (path.startsWith('/') && path.length <= 32768 && !/[\x00-\x1f\x7f]/.test(path)) cwd = path
      } catch {
        // An invalid OSC URI must not interrupt terminal output.
      }
      consumed = match.index! + match[0].length
    }
    this.tail = this.tail.slice(consumed)
    if (!this.command) return { data: input, cwd, ready: false }

    this.pending = Buffer.concat([this.pending, input])
    const ack = this.pending.indexOf(READY)
    if (ack >= 0) {
      this.pending = Buffer.concat([this.pending.subarray(0, ack), this.pending.subarray(ack + READY.length)])
      return { data: this.finishBootstrap(), cwd, ready: true }
    }
    // A misbehaving startup script cannot retain unlimited terminal output.
    if (this.pending.length > 65536) return { data: this.finishBootstrap(), cwd, ready: true }
    const end = this.pending.lastIndexOf(10)
    const data = this.stripEchoes(this.pending.subarray(0, end + 1))
    this.pending = this.pending.subarray(end + 1)
    return { data, cwd, ready: false }
  }
}
