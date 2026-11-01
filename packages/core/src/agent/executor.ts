import type { Client, ClientChannel } from 'ssh2'
import { StringDecoder } from 'node:string_decoder'
import type { AiResult } from '@eizhu/contracts'

export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

/** A separate non-PTY channel, with closed stdin and bounded output. Never retries. */
export function executeAgentCommand(
  client: Client,
  command: string,
  cwd: string,
  seconds: number,
  signal: AbortSignal,
  output: (stdout: string, stderr: string) => void,
): Promise<AiResult> {
  const start = Date.now()
  return new Promise((resolve) => {
    let channel: ClientChannel | undefined,
      done = false,
      seenExit = false,
      code: number | null = null
    let stdout = '',
      stderr = '',
      retained = 0,
      truncated = false
    const out = new StringDecoder('utf8'),
      err = new StringDecoder('utf8')
    const finish = (message = '') => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      client.removeListener('close', disconnected)
      stdout += out.end()
      stderr += err.end()
      resolve({
        status: seenExit ? 'completed' : 'unknown',
        stdout,
        stderr,
        exitCode: seenExit ? code : null,
        elapsedMs: Date.now() - start,
        truncated,
        message,
      })
    }
    const stop = (message: string) => {
      // SSH signal support depends on the server; closing a channel is not proof that the remote process exited.
      channel?.signal('TERM')
      channel?.destroy()
      finish(message)
    }
    const abort = () => stop('已停止等待，无法保证远端进程已结束；请核查后再操作')
    const disconnected = () => finish('SSH 已断开，执行结果未知，请勿直接重跑')
    const timer = setTimeout(() => stop('命令超时，远端结果未知，请在终端核查'), seconds * 1000)
    signal.addEventListener('abort', abort, { once: true })
    client.once('close', disconnected)
    if (signal.aborted) {
      abort()
      return
    }
    // Execute in POSIX sh. The approved command is unchanged; stdin is EOF and sudo must be non-interactive.
    const script = `cd -- ${shellQuote(cwd)} && exec sh -c ${shellQuote(command)}`
    client.exec(script, (error, stream) => {
      if (error) {
        finish('服务器拒绝执行；可能不支持 exec，请使用终端处理')
        return
      }
      channel = stream
      if (done) {
        stream.destroy()
        return
      }
      const append = (bytes: Buffer, isError: boolean) => {
        const available = Math.max(0, 262144 - retained),
          chunk = bytes.subarray(0, available)
        retained += chunk.length
        truncated ||= chunk.length < bytes.length
        if (isError) stderr += err.write(chunk)
        else stdout += out.write(chunk)
        if (chunk.length) output(stdout, stderr)
      }
      stream.on('data', (b: Buffer) => append(b, false))
      stream.stderr.on('data', (b: Buffer) => append(b, true))
      stream.on('exit', (value: number | null) => {
        if (Number.isInteger(value)) {
          code = value
          seenExit = true
        }
      })
      stream.once('close', () => finish(seenExit ? '' : '远端未返回退出码，执行结果未知'))
      stream.once('error', () => finish('执行通道中断，结果未知'))
      stream.end()
    })
  })
}
