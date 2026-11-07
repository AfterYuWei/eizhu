/* eslint-disable no-control-regex -- Synthetic SSH terminal control bytes. */
import { StringDecoder } from 'node:string_decoder'

export function createAiSmokeShell(
  write: (data: string) => void,
  commands: string[],
  isLongRunning: () => boolean,
) {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  return (bytes: Buffer) => {
    pending += decoder.write(bytes)
    if (pending.length > 262144) throw new Error('AI smoke shell input exceeds limit')
    let end: number
    while ((end = pending.search(/[\r\n\x03]/)) >= 0) {
      const script = pending.slice(0, end),
        interrupt = pending[end] === '\x03'
      pending = pending.slice(end + 1)
      if (!script && !interrupt) continue
      write(interrupt ? '^C\r\n' : script + '\r\n')
      const token = !interrupt && script.match(/eizhuAi;([\w-]+);start/)?.[1]
      if (token) {
        commands.push(script)
        write('\x1b]1337;eizhuAi;' + token + ';start\x07')
        write('你好 🧪\r\nsynthetic warning\r\n')
        if (isLongRunning()) continue
        write('\x1b]1337;eizhuAi;' + token + ';end;3\x07')
      }
      write('\x1b]7;file:///tmp\x07\x1b]1337;eizhuPrompt\x07')
      if (!interrupt && script.includes('__eizhu_osc7')) write('\x1b]1337;eizhuOsc7Ready\x07')
      write('$ ')
    }
  }
}
