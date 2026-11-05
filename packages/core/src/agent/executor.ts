import { randomUUID } from 'node:crypto'
import type { ClientChannel } from 'ssh2'
import { StringDecoder } from 'node:string_decoder'
import type { AiResult } from '@eizhu/contracts'

export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

/** Run in the existing PTY. Observe output without consuming or closing the terminal. Never retries. */
export function executeAgentCommand(
  channel: ClientChannel,
  shell: 'bash' | 'zsh' | 'fish' | 'sh',
  command: string,
  cwd: string,
  seconds: number,
  signal: AbortSignal,
  output: (stdout: string, stderr: string) => void,
  beforeWrite?: (begin: Buffer) => void,
): Promise<AiResult> {
  const start = Date.now(),
    token = randomUUID(),
    begin = Buffer.from(`\x1b]1337;eizhuAi;${token};start\x07`),
    end = Buffer.from(`\x1b]1337;eizhuAi;${token};end;`)
  return new Promise((resolve) => {
    let done = false,
      started = false,
      pending = Buffer.alloc(0),
      stdout = '',
      retained = 0,
      truncated = false
    const decoder = new StringDecoder('utf8')
    const append = (bytes: Buffer) => {
      const chunk = bytes.subarray(0, Math.max(0, 262144 - retained))
      retained += chunk.length
      truncated ||= chunk.length < bytes.length
      stdout += decoder.write(chunk)
      if (chunk.length) output(stdout, '')
    }
    const finish = (code: number | null, message: string) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      channel.removeListener('close', disconnected)
      channel.removeListener('error', disconnected)
      channel.removeListener('data', consume)
      channel.stderr.removeListener('data', consume)
      if (started && pending.length) append(pending)
      const tail = decoder.end()
      if (!truncated) stdout += tail
      resolve({
        status: code === null ? 'unknown' : 'completed',
        stdout,
        stderr: '', // A PTY combines stdout and stderr, as it does for manually entered commands.
        exitCode: code,
        elapsedMs: Date.now() - start,
        truncated,
        message,
      })
    }
    const stop = (message: string) => {
      // Ctrl+C targets the current terminal's foreground job; keep the shared shell open.
      if (!channel.destroyed && channel.writable) channel.write('\x03')
      finish(null, message)
    }
    const abort = () => stop('已向当前终端发送 Ctrl+C；执行结果未知，请在终端核查后再操作')
    const disconnected = () => finish(null, 'SSH 终端已断开，执行结果未知，请勿直接重跑')
    const consume = (bytes: Buffer) => {
      pending = Buffer.concat([pending, bytes])
      if (!started) {
        const at = pending.indexOf(begin)
        if (at < 0) {
          pending = pending.subarray(Math.max(0, pending.length - begin.length + 1))
          return
        }
        started = true
        pending = pending.subarray(at + begin.length)
      }
      const at = pending.indexOf(end)
      if (at >= 0) {
        append(pending.subarray(0, at))
        pending = pending.subarray(at)
        const terminator = pending.indexOf(7, end.length)
        if (terminator < 0 && pending.length < end.length + 16) return
        const status = pending.subarray(end.length, terminator).toString()
        if (terminator >= 0 && /^\d{1,3}$/.test(status)) {
          pending = Buffer.alloc(0)
          finish(Number(status), '已在当前 SSH 终端执行；标准输出与错误输出合并显示')
          return
        }
        // A malformed marker is ordinary terminal output, not a successful command result.
        append(pending.subarray(0, 1))
        pending = pending.subarray(1)
      }
      const count = Math.max(0, pending.length - end.length + 1)
      append(pending.subarray(0, count))
      pending = pending.subarray(count)
    }
    const timer = setTimeout(
      () => stop('命令超时，已向当前终端发送 Ctrl+C；请在终端核查结果'),
      seconds * 1000,
    )
    if (signal.aborted) {
      finish(null, '任务已取消，命令未发送到终端')
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    channel.once('close', disconnected)
    channel.once('error', disconnected)
    channel.on('data', consume)
    channel.stderr.on('data', consume)
    // eval runs in this shell, preserving cd/export/aliases/functions for subsequent terminal input.
    // Encode line breaks/tabs so readline cannot interpret them as Enter or completion keys.
    const quote = (value: string) =>
      shellQuote(value)
        .replaceAll('\n', () => (shell === 'fish' ? "'\\n'" : "'$'\\n''"))
        .replaceAll('\t', () => (shell === 'fish' ? "'\\t'" : "'$'\\t''"))
    const encoded =
      shell === 'sh'
        ? `"$(command printf '%b' '${Array.from(Buffer.from(command))
            .map((b) => '\\0' + b.toString(8).padStart(3, '0'))
            .join('')}')"`
        : quote(command)
    const script = ` printf '\\033]1337;eizhuAi;${token};start\\007'; cd -- ${quote(cwd)} && eval ${encoded}; printf '\\033]1337;eizhuAi;${token};end;%s\\007' ${shell === 'fish' ? '$status' : '"$?"'}`
    beforeWrite?.(begin)
    channel.write(script + '\r')
  })
}
