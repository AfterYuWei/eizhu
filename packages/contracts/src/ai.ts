import { z } from 'zod'

const id = z.string().min(1).max(160)
const text = z.string().max(196608)
export const aiEndpointSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const u = new URL(value)
    return (
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
    )
  }, '远程接口须使用 HTTPS，本机服务可使用 HTTP')
export const aiPreferencesSchema = z.strictObject({
  source: z.enum(['official', 'custom']),
  protocol: z.enum(['chat', 'responses']),
  endpoint: z.union([z.literal(''), aiEndpointSchema]),
  model: z.string().max(160),
})
export const aiSettingsSchema = aiPreferencesSchema.extend({ hasApiKey: z.boolean() })
export const aiCapabilitiesSchema = z.strictObject({
  available: z.boolean(),
  models: z.array(z.strictObject({ id, name: z.string().max(160) })).max(100),
  defaultModel: z.string().max(160),
  dailyTokenLimit: z.int().nonnegative(),
  remainingTokens: z.int().nonnegative(),
  message: z.string().max(1024),
})
export const aiCommandSchema = z.strictObject({
  command: z
    .string()
    .min(1)
    .max(16384)
    .refine(
      (v) =>
        !Array.from(v).some(
          (c) => (c.charCodeAt(0) < 32 && c !== '\t' && c !== '\n') || c.charCodeAt(0) === 127,
        ),
    ),
  cwd: z
    .string()
    .min(1)
    .max(32768)
    .refine(
      (v) => v.startsWith('/') && !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
    ),
  purpose: z.string().min(1).max(2048),
  impact: z.string().min(1).max(2048),
})
export const aiResultSchema = z.strictObject({
  status: z.enum(['completed', 'unknown', 'rejected', 'expired']),
  stdout: z.string().max(262144),
  stderr: z.string().max(262144),
  exitCode: z.int().nullable(),
  elapsedMs: z.number().nonnegative(),
  truncated: z.boolean(),
  message: z.string().max(2048),
})
export const aiProposalSchema = aiCommandSchema.extend({
  id: z.uuid(),
  timeoutSeconds: z.int().min(1).max(600),
  state: z.enum(['pending', 'running', 'completed', 'unknown', 'rejected', 'expired']),
  result: aiResultSchema.optional(),
})
export const aiMessageSchema = z.strictObject({
  id: z.uuid(),
  role: z.enum(['user', 'assistant']),
  text,
  proposal: aiProposalSchema.optional(),
})
export const aiTargetSchema = z.strictObject({
  profileId: id,
  sessionId: id,
  host: z.string().max(512),
  username: z.string().max(512),
  port: z.int(),
  cwd: z.string().max(32768),
  system: z.string().max(4096),
})
export const aiConversationSchema = z.strictObject({
  id: z.uuid(),
  profileId: id,
  title: z.string().max(120),
  updatedAt: z.number(),
  source: z.enum(['official', 'custom']),
  model: z.string().max(160),
  messages: z.array(aiMessageSchema).max(200),
  status: z.enum(['idle', 'thinking', 'awaiting_confirmation', 'executing', 'error']),
  error: z.string().max(2048),
  target: aiTargetSchema,
})
export const aiSummarySchema = aiConversationSchema.pick({
  id: true,
  profileId: true,
  title: true,
  updatedAt: true,
  source: true,
  model: true,
})
export const aiAttachmentSchema = z.strictObject({
  name: z.string().min(1).max(255),
  content: z.string().max(131072),
})
export const ai = {
  'ai.settings': { input: z.undefined(), output: aiSettingsSchema },
  'ai.configure': {
    input: aiPreferencesSchema.extend({ apiKey: z.string().max(8192).optional() }),
    output: aiSettingsSchema,
  },
  'ai.capabilities': { input: z.undefined(), output: aiCapabilitiesSchema },
  'ai.test': { input: z.undefined(), output: z.strictObject({ message: z.string().max(1024) }) },
  'ai.open': {
    input: z.strictObject({ sessionId: id, conversationId: z.uuid().optional() }),
    output: aiConversationSchema,
  },
  'ai.history': { input: z.strictObject({ profileId: id }), output: z.array(aiSummarySchema).max(100) },
  'ai.read': {
    input: z.strictObject({ profileId: id, conversationId: z.uuid() }),
    output: aiConversationSchema,
  },
  'ai.remove': {
    input: z.strictObject({ profileId: id, conversationId: z.uuid().optional() }),
    output: z.void(),
  },
  'ai.send': {
    input: z.strictObject({
      conversationId: z.uuid(),
      text: z.string().min(1).max(16384),
      attachments: z.array(aiAttachmentSchema).max(8),
    }),
    output: z.void(),
  },
  'ai.decide': { input: z.strictObject({ proposalId: z.uuid(), accepted: z.boolean() }), output: z.void() },
  'ai.setTimeout': {
    input: z.strictObject({ proposalId: z.uuid(), seconds: z.int().min(1).max(600) }),
    output: z.void(),
  },
  'ai.cancel': { input: z.strictObject({ conversationId: z.uuid() }), output: z.void() },
} as const
export type AiOperation = keyof typeof ai
export type AiClient = {
  [K in AiOperation as K extends `ai.${infer M}` ? M : never]: z.input<
    (typeof ai)[K]['input']
  > extends undefined
    ? () => Promise<z.output<(typeof ai)[K]['output']>>
    : (input: z.input<(typeof ai)[K]['input']>) => Promise<z.output<(typeof ai)[K]['output']>>
}
export const isAiOperation = (value: string): value is AiOperation => Object.hasOwn(ai, value)
export type AiSettings = z.infer<typeof aiSettingsSchema>
export type AiPreferences = z.infer<typeof aiPreferencesSchema>
export type AiConversation = z.infer<typeof aiConversationSchema>
export type AiProposal = z.infer<typeof aiProposalSchema>
export type AiResult = z.infer<typeof aiResultSchema>
export type AiTarget = z.infer<typeof aiTargetSchema>
export type AiCapabilities = z.infer<typeof aiCapabilitiesSchema>
export const aiEventSchema = z.union([
  z.strictObject({ workspaceGeneration: z.int(), conversation: aiConversationSchema }),
  z.strictObject({ workspaceGeneration: z.int(), conversationId: z.uuid(), message: aiMessageSchema }),
])
export type AiEvent = z.infer<typeof aiEventSchema>

/** Internal transport only. Renderer methods never accept URLs, headers or request bodies. */
export const aiHttpRequestSchema = z
  .strictObject({
    source: z.enum(['official', 'custom']),
    url: aiEndpointSchema,
    method: z.enum(['GET', 'POST']),
    authorization: z
      .string()
      .max(8192)
      .refine((v) => !/[\r\n]/.test(v)),
    body: z.string().max(524288).optional(),
  })
  .superRefine((r, ctx) => {
    const u = new URL(r.url)
    if (
      r.source === 'official' &&
      (u.origin !== 'https://eizhu.yuweinfo.com' ||
        !['/api/ai/v1/capabilities', '/api/ai/v1/chat'].includes(u.pathname))
    )
      ctx.addIssue({ code: 'custom', message: '官方 AI 请求地址无效' })
  })
export type AiHttpRequest = z.infer<typeof aiHttpRequestSchema>
