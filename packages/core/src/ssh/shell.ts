/* eslint-disable no-control-regex -- OSC sequences are terminal control bytes. */
import { StringDecoder } from 'node:string_decoder'

const READY = Buffer.from('\x1b]1337;eizhuOsc7Ready\x07')

/** Install only the session-local hook supported by the detected login shell. */
export function shellSetupCommand(output: string): string | undefined {
  for (const line of output.trim().split(/\r?\n/).reverse()) {
    const name = line.trim().split('/').pop()?.replace(/^-/, '')
    let hook: string
    if (name === 'bash') {
      hook = [
        String.raw` __eizhu_osc7(){ local s=$?;printf "\033]7;file://%s\007" "$(pwd -P 2>/dev/null)";`,
        // PS0 is a pre-execution prompt in Bash 4.4+. Older Bash keeps CWD tracking only.
        String.raw`if (( BASH_VERSINFO[0]>4 || (BASH_VERSINFO[0]==4 && BASH_VERSINFO[1]>=4) ));then case "$PS1" in *'\[\e]133;A\a\]'*) ;; *) PS1='\[\e]133;A\a\]'"$PS1"'\[\e]133;B\a\]';;esac;case "$PS2" in *'\[\e]133;A;k=s\a\]'*) ;; *) PS2='\[\e]133;A;k=s\a\]'"$PS2"'\[\e]133;B\a\]';;esac;fi;return "$s";};`,
        // Append without flattening an existing PROMPT_COMMAND array or replacing user hooks.
        String.raw`case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in 'declare -a'*) case " ${'${PROMPT_COMMAND[*]}'} " in *' __eizhu_osc7 '*) ;; *) PROMPT_COMMAND+=(__eizhu_osc7);;esac;; *) case ";${'${PROMPT_COMMAND-}'};" in *';__eizhu_osc7;'*) ;; *) PROMPT_COMMAND="${'${PROMPT_COMMAND:+$PROMPT_COMMAND;}'}__eizhu_osc7";;esac;;esac;`,
        String.raw`if (( BASH_VERSINFO[0]>4 || (BASH_VERSINFO[0]==4 && BASH_VERSINFO[1]>=4) ));then case "${'${PS0-}'}" in *'\e]133;C\a'*) ;; *) PS0='\e]133;C\a'"${'${PS0-}'}";;esac;fi;__eizhu_osc7`,
      ].join('')
    } else if (name === 'zsh') {
      hook = [
        String.raw` __eizhu_osc7(){ local s=$?;printf "\033]7;file://%s\007" "$(pwd -P 2>/dev/null)";local a=$'%{\e]133;A\a%}' b=$'%{\e]133;B\a%}' c=$'%{\e]133;A;k=s\a%}';[[ "$PS1" == *"$a"* ]] || PS1="$a$PS1$b";[[ "$PS2" == *"$c"* ]] || PS2="$c$PS2$b";return "$s";};`,
        String.raw`__eizhu_preexec(){ printf '\033]133;C\007';};autoload -Uz add-zsh-hook;add-zsh-hook -d precmd __eizhu_osc7 2>/dev/null;add-zsh-hook -d preexec __eizhu_preexec 2>/dev/null;add-zsh-hook precmd __eizhu_osc7;add-zsh-hook preexec __eizhu_preexec;__eizhu_osc7`,
      ].join('')
    } else if (name === 'fish') {
      hook = [
        String.raw` function __eizhu_osc7 --on-variable PWD --on-event fish_prompt;printf '\033]7;file://%s\007' (pwd -P 2>/dev/null);end;`,
        String.raw`if not functions -q __eizhu_original_fish_prompt;if functions -c fish_prompt __eizhu_original_fish_prompt;function fish_prompt;__eizhu_original_fish_prompt;printf '\033]133;B\007';end;end;end;`,
        String.raw`if functions -q __eizhu_original_fish_prompt;function __eizhu_prompt_start --on-event fish_prompt;printf '\033]133;A\007';end;function __eizhu_preexec --on-event fish_preexec;printf '\033]133;C\007';end;end;__eizhu_osc7`,
      ].join('')
    } else continue
    return hook + String.raw`;printf "\033]1337;eizhuOsc7Ready\007"`
  }
}

/** Preserve binary terminal output while hiding the setup command's echoed lines. */
export class ShellOutput {
  private decoder = new StringDecoder('utf8')
  private tail = ''
  private command?: string
  private pending = Buffer.alloc(0)

  startBootstrap(command: string): void {
    // Readline/ZLE insert cursor controls into long command echoes. Match the short
    // initial definition instead of requiring the whole echoed command to be contiguous.
    this.command = command.trimStart().startsWith('function ')
      ? 'function __eizhu_osc7 --' : '__eizhu_osc7(){'
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
      // ZLE soft-wraps a long input with "erase to end / print one cell / CR",
      // then repeats that cell. Normalize only for comparison; preserve original bytes.
      const echoed = line.toString('utf8').replace(/ \r\x1b\[(?:0)?K[^\r\n]\r/g, '')
      if (!this.command || !echoed.includes(this.command)) lines.push(line)
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
