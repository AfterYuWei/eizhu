import { streamText, tool, modelMessageSchema } from 'ai'
import type { ModelMessage, ToolSet } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { aiTools, aiToolNameSchema, fail, redactLogText } from '@eizhu/contracts'
import type { AiHttpRequest, AiToolName } from '@eizhu/contracts'
import type { storedProviderSchema } from './repository.ts'
export type AiTransport = (
  request: AiHttpRequest,
  signal: AbortSignal,
  consume: (bytes: Uint8Array) => Promise<void>,
) => Promise<void>
export type WireMessage = ModelMessage
export const wireMessageSchema = modelMessageSchema
export function redactAiText(value: string, secrets: string[] = []): string {
  let result = value
  for (const secret of secrets) if (secret) result = result.split(secret).join('[已隐藏]')
  return redactLogText(result).replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]+)\b/g, '[已隐藏]')
}
export interface ModelStep {
  text: string
  calls: Array<{ id: string; name: AiToolName; args: Record<string, z.infer<ReturnType<typeof z.json>>> }>
  messages: ModelMessage[]
}
/** SDK tool-call events can precede a final provider event. They never grant execution. */
class CompletionBoundary {
  private decoder = new TextDecoder()
  private buffer = ''
  private data: string[] = []
  completed = false
  failed = false
  protocol: 'responses' | 'chat' | 'anthropic'
  constructor(protocol: 'responses' | 'chat' | 'anthropic') {
    this.protocol = protocol
  }
  push(bytes: Uint8Array) {
    this.buffer += this.decoder.decode(bytes, { stream: true })
    if (this.buffer.length > 2097152) fail('AI_PROTOCOL', '模型事件超过上限')
    let end: number
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '')
      this.buffer = this.buffer.slice(end + 1)
      if (line.startsWith('data:')) this.data.push(line.slice(5).trimStart())
      if (!line && this.data.length) {
        const data = this.data.join('\n')
        this.data = []
        if (data === '[DONE]') {
          if (this.protocol === 'chat') this.completed = true
          continue
        }
        const event = z
          .object({
            type: z.string().optional(),
            response: z.object({ status: z.string().optional() }).optional(),
          })
          .passthrough()
          .parse(JSON.parse(data))
        if (['error', 'response.failed', 'response.incomplete'].includes(event.type ?? '')) this.failed = true
        if (this.protocol === 'responses' && event.type === 'response.completed')
          this.completed = event.response?.status === 'completed'
        if (this.protocol === 'anthropic' && event.type === 'message_stop') this.completed = true
      }
    }
  }
}
/** Adapts the bounded Electron network relay to SDK fetch without bypassing its proxy/TLS or backpressure. */
export function modelFetch(
  transport: AiTransport,
  source: 'official' | 'custom',
  parentSignal: AbortSignal,
  boundary?: CompletionBoundary,
): typeof fetch {
  return async (url, init) => {
    if (typeof init?.body !== 'string' || Buffer.byteLength(init.body) > 524288)
      fail('AI_CONTEXT_LIMIT', '模型请求超过512KiB')
    const requestBody = init.body
    const controller = new AbortController()
    const signal = AbortSignal.any([parentSignal, controller.signal, ...(init.signal ? [init.signal] : [])])
    const headers = new Headers(init.headers)
    const authorization = headers.get('authorization') ?? ''
    headers.delete('authorization')
    let release: (() => void) | undefined
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        void transport(
          {
            source,
            url: String(url),
            method: 'POST',
            authorization,
            headers: Object.fromEntries(headers),
            body: requestBody,
          },
          signal,
          async (bytes) => {
            signal.throwIfAborted()
            boundary?.push(bytes)
            stream.enqueue(Uint8Array.from(bytes))
            if ((stream.desiredSize ?? 0) <= 0)
              await new Promise<void>((resolve) => {
                const finish = () => {
                  signal.removeEventListener('abort', finish)
                  release = undefined
                  resolve()
                }
                release = finish
                signal.addEventListener('abort', finish, { once: true })
                if (signal.aborted) finish()
              })
          },
        ).then(
          () => {
            release?.()
            stream.close()
          },
          (error) => {
            release?.()
            stream.error(error)
          },
        )
      },
      pull() {
        release?.()
      },
      cancel() {
        controller.abort()
        release?.()
      },
    })
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  }
}
export async function generateModel(input: {
  provider: z.infer<typeof storedProviderSchema>
  source: 'official' | 'custom'
  token?: string
  transport: AiTransport
  signal: AbortSignal
  system: string
  messages: ModelMessage[]
  onText: (text: string) => void
  summarize?: boolean
  connectionTest?: boolean
}): Promise<ModelStep> {
  const p = input.provider
  const boundary = new CompletionBoundary(p.protocol)
  const options = {
    baseURL: p.endpoint,
    apiKey: input.source === 'official' ? input.token : p.apiKey,
    fetch: modelFetch(input.transport, input.source, input.signal, boundary),
  }
  const openai = createOpenAI(options)
  const model =
    p.protocol === 'anthropic'
      ? createAnthropic(options)(p.model)
      : p.protocol === 'chat'
        ? openai.chat(p.model)
        : openai.responses(p.model)
  const tools: ToolSet = {}
  if (!input.summarize)
    for (const [name, definition] of Object.entries(aiTools)) {
      if (input.connectionTest && name !== 'session_info') continue
      const schema: z.ZodType<unknown> = definition.input
      tools[name] = tool({ description: definition.description, inputSchema: schema, strict: false })
    }
  const result = streamText({
    model,
    system: input.system,
    messages: input.messages,
    tools,
    abortSignal: input.signal,
    maxRetries: 0,
    maxOutputTokens:
      input.source === 'official'
        ? undefined
        : Math.min(input.summarize ? 4096 : 8192, Math.floor(p.contextWindow / 4)),
    providerOptions:
      p.protocol === 'responses'
        ? { openai: { store: false, include: ['reasoning.encrypted_content'], parallelToolCalls: false } }
        : p.protocol === 'chat'
          ? { openai: { parallelToolCalls: false } }
          : { anthropic: { disableParallelToolUse: true } },
  })
  let text = ''
  for await (const part of result.fullStream) {
    if (part.type === 'error') throw part.error
    if (part.type === 'text-delta') {
      text += part.text
      if (text.length > 65536) fail('AI_PROTOCOL', '模型回复超过上限')
      input.onText(text)
    }
  }
  input.signal.throwIfAborted()
  if (!boundary.completed || boundary.failed)
    fail('AI_STREAM_INTERRUPTED', '模型流未完整结束，未生成有效工具调用')
  const finish = await result.finishReason
  if (!['stop', 'tool-calls'].includes(finish))
    fail('AI_STREAM_INTERRUPTED', '模型回复不完整，未生成有效工具调用')
  const calls = (await result.toolCalls).map((call) => {
    const name = aiToolNameSchema.parse(call.toolName)
    return {
      id: call.toolCallId,
      name,
      args: z.record(z.string(), z.json()).parse(aiTools[name].input.parse(call.input)),
    }
  })
  if (calls.length > 32 || new Set(calls.map((c) => c.id)).size !== calls.length)
    fail('AI_PROTOCOL', '工具调用数量或调用标识无效')
  const response = await result.response
  return { text, calls, messages: response.messages.map((message) => modelMessageSchema.parse(message)) }
}
