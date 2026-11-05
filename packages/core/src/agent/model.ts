import { z } from 'zod'
import { aiCommandSchema, fail, redactLogText } from '@eizhu/contracts'
import type { AiHttpRequest } from '@eizhu/contracts'
import type { storedAiConfigSchema } from './repository.ts'

export type AiTransport = (
  request: AiHttpRequest,
  signal: AbortSignal,
  consume: (bytes: Uint8Array) => Promise<void>,
) => Promise<void>
export const wireMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  callId: z.string().optional(),
  responseItems: z.array(z.json()).optional(),
})
export type WireMessage = z.infer<typeof wireMessageSchema>
type Config = z.infer<typeof storedAiConfigSchema>
const parameters = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description:
        '在当前 SSH 窗口的交互式 shell 执行的一条完整命令，沿用当前终端环境；交互输入由用户在终端完成。',
    },
    cwd: { type: 'string', description: '远端绝对工作目录' },
    purpose: { type: 'string', description: '中文说明命令目的' },
    impact: { type: 'string', description: '中文说明修改、风险或只读影响' },
  },
  required: ['command', 'cwd', 'purpose', 'impact'],
  additionalProperties: false,
}
export function redactAiText(value: string, secrets: string[] = []): string {
  let result = value
  for (const secret of secrets) if (secret) result = result.split(secret).join('[已隐藏]')
  return redactLogText(result).replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]+)\b/g, '[已隐藏]')
}
export function redactAiJson(
  value: z.infer<ReturnType<typeof z.json>>,
  secrets: string[],
): z.infer<ReturnType<typeof z.json>> {
  if (typeof value === 'string') return redactAiText(value, secrets)
  if (Array.isArray(value)) return value.map((v) => redactAiJson(v, secrets))
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactAiJson(v, secrets)]))
  return value
}

/** Incremental UTF-8 SSE decoder. Incomplete events never become executable proposals. */
export class AiSseDecoder {
  private decoder = new TextDecoder()
  private buffer = ''
  private data: string[] = []
  private consume: (data: string) => void
  constructor(consume: (data: string) => void) {
    this.consume = consume
  }
  push(bytes: Uint8Array): void {
    this.buffer += this.decoder.decode(bytes, { stream: true })
    if (this.buffer.length > 2 * 1024 * 1024) fail('AI_PROTOCOL', '模型事件超过上限')
    let end: number
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '')
      this.buffer = this.buffer.slice(end + 1)
      if (!line) {
        if (this.data.length) this.consume(this.data.join('\n'))
        this.data = []
      } else if (line.startsWith('data:')) {
        this.data.push(line.slice(5).replace(/^ /, ''))
        if (this.data.reduce((n, v) => n + v.length, 0) > 2 * 1024 * 1024)
          fail('AI_PROTOCOL', '模型事件超过上限')
      }
    }
  }
}

export function modelRequest(
  config: Config,
  token: string,
  wire: WireMessage[],
  requireTool = false,
): AiHttpRequest {
  const base = config.endpoint.replace(/\/$/, '')
  const tool = {
    name: 'run_command',
    description: '请求用户确认后，在当前服务器执行一条命令。每次只提议一条，等待结果再继续。',
    parameters,
    strict: true,
  }
  const input = wire.flatMap<z.infer<ReturnType<typeof z.json>>>((m) => {
    if (m.role === 'tool')
      return [
        {
          type: 'function_call_output',
          call_id: m.callId ?? fail('AI_PROTOCOL', '工具结果缺少标识'),
          output: m.content,
        },
      ]
    if (m.role === 'assistant' && m.responseItems) return m.responseItems
    return [{ role: m.role, content: m.content }]
  })
  const body = {
    model: config.model,
    input,
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    tools: [{ type: 'function', ...tool }],
    parallel_tool_calls: false,
    ...(requireTool && config.source === 'custom' ? { max_output_tokens: 256 } : {}),
    ...(requireTool ? { tool_choice: { type: 'function', name: tool.name } } : {}),
  }
  return {
    source: config.source,
    url:
      config.source === 'official' ? 'https://eizhu.yuweinfo.com/api/ai/v1/responses' : `${base}/responses`,
    method: 'POST',
    authorization: config.source === 'official' ? token : config.apiKey ? `Bearer ${config.apiKey}` : '',
    body: JSON.stringify(body),
  }
}

export async function generateModel(
  transport: AiTransport,
  request: AiHttpRequest,
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  let text = '',
    completed = false,
    callId = '',
    name = '',
    args = ''
  let responseItems: z.infer<ReturnType<typeof z.json>>[] | undefined
  const append = (value: string) => {
    text += value
    if (text.length > 65536) fail('AI_PROTOCOL', '模型回复超过上限')
    onText(text)
  }
  const parser = new AiSseDecoder((data) => {
    if (completed) fail('AI_PROTOCOL', '模型完成事件重复或顺序无效')
    const raw: unknown = JSON.parse(data)
    const event = z
      .object({
        type: z.string(),
        delta: z.string().optional(),
        response: z.object({ status: z.string(), output: z.array(z.json()) }).optional(),
      })
      .parse(raw)
    if (event.type === 'response.output_text.delta') append(event.delta ?? '')
    if (['error', 'response.failed', 'response.incomplete'].includes(event.type))
      fail('AI_PROTOCOL', '模型生成失败或内容不完整')
    if (event.type === 'response.completed') {
      if (event.response?.status !== 'completed') fail('AI_PROTOCOL', '模型生成未完成')
      completed = true
      responseItems = event.response.output
      for (const item of event.response.output) {
        const value = z
          .object({
            type: z.string(),
            call_id: z.string().optional(),
            name: z.string().optional(),
            arguments: z.string().optional(),
          })
          .parse(item)
        if (value.type !== 'function_call') continue
        if (callId) fail('AI_PROTOCOL', '模型一次只能提议一条命令')
        callId = value.call_id ?? ''
        name = value.name ?? ''
        args = value.arguments ?? ''
      }
    }
    if (args.length > 32768 || callId.length > 256) fail('AI_PROTOCOL', '模型命令超过上限')
  })
  await transport(request, signal, async (bytes) => parser.push(bytes))
  if (signal.aborted || !completed) fail('AI_STREAM_INTERRUPTED', '模型回复已中断，未生成可执行命令')
  let command: z.infer<typeof aiCommandSchema> | undefined
  if (callId || name || args) {
    if (!callId || name !== 'run_command') fail('AI_PROTOCOL', '模型工具调用无效')
    command = aiCommandSchema.parse(JSON.parse(args))
  }
  const message: WireMessage = {
    role: 'assistant',
    content: text,
    ...(command ? { callId } : {}),
    ...(responseItems ? { responseItems } : {}),
  }
  return { text, command, callId, message }
}
