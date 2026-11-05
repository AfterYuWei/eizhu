import { connect } from 'node:net'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema, ToolSchema } from '@modelcontextprotocol/sdk/types.js'
import { aiToolManifest, aiToolNameSchema, failureOf } from '@eizhu/contracts'
const socketPath = z.string().min(1).parse(process.env.EIZHU_AGENT_SOCKET)
const token = z.string().length(64).parse(process.env.EIZHU_AGENT_TOKEN)
delete process.env.EIZHU_AGENT_TOKEN
const server = new Server({ name: 'eizhu-remote-tools', version: '2' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: aiToolManifest.map((d) =>
    ToolSchema.parse({ name: d.name, description: d.description, inputSchema: d.parameters }),
  ),
}))
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  try {
    const name = aiToolNameSchema.parse(request.params.name)
    const result = await new Promise<unknown>((resolve, reject) => {
      const socket = connect(socketPath),
        id = randomUUID()
      let buffer = '',
        settled = false
      const finish = (error?: unknown, value?: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        if (error) reject(error)
        else resolve(value)
      }
      const timer = setTimeout(() => finish(new Error('工具调用超时')), 600000)
      const abort = () => finish(new Error('工具调用已取消'))
      extra.signal.addEventListener('abort', abort, { once: true })
      socket.once('close', () => extra.signal.removeEventListener('abort', abort))
      if (extra.signal.aborted) abort()
      socket.setEncoding('utf8')
      socket.once('error', finish)
      socket.once('connect', () =>
        socket.write(JSON.stringify({ token, id, name, args: request.params.arguments ?? {} }) + '\n'),
      )
      socket.on('data', (chunk: string) => {
        buffer += chunk
        if (buffer.length > 524288) {
          finish(new Error('工具结果超过上限'))
          return
        }
        if (!buffer.includes('\n')) return
        try {
          const result = z
            .object({ id: z.literal(id), result: z.unknown().optional(), error: z.unknown().optional() })
            .parse(JSON.parse(buffer.trim()))
          if (result.error) finish(new Error('远端工具调用失败'))
          else finish(undefined, result.result)
        } catch (error) {
          finish(error)
        }
      })
      socket.once('close', () => {
        if (!settled) finish(new Error('工具通道已关闭'))
      })
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  } catch (error) {
    return { isError: true, content: [{ type: 'text' as const, text: failureOf(error).message }] }
  }
})
void server.connect(new StdioServerTransport()).catch(() => process.exit(1))
