import { z } from 'zod'
import { aiJobSchema, aiToolNameSchema, AI_TOOLSET_VERSION } from './ai-tools.ts'
export * from './ai-tools.ts'
const id = z.string().min(1).max(160)
export const aiEndpointSchema = z
  .url()
  .max(2048)
  .pipe(
    z.string().refine((value) => {
      const u = new URL(value)
      return (
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        (u.protocol === 'https:' ||
          (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
      )
    }, '远程接口须使用HTTPS，本机服务可使用HTTP'),
  )
export const aiProtocolSchema = z.enum(['responses', 'chat', 'anthropic'])
const aiModelsSchema = z.array(z.strictObject({ id, name: z.string().max(160) })).max(1000)
export const aiProviderSchema = z.strictObject({
  id,
  name: z.string().min(1).max(80),
  protocol: aiProtocolSchema,
  endpoint: aiEndpointSchema,
  model: z.string().min(1).max(160),
  contextWindow: z.int().min(4096).max(2000000).default(64000),
  models: aiModelsSchema.optional(),
  hasApiKey: z.boolean(),
})
export const aiConnectionSchema = aiProviderSchema
  .omit({ hasApiKey: true })
  .extend({ apiKey: z.string().max(8192).optional(), clearKey: z.boolean().default(false) })
// 模型目录发现发生在选择模型之前，不能要求已知模型名。
export const aiDiscoverySchema = aiConnectionSchema
  .omit({ models: true })
  .extend({ model: z.string().max(160).default('') })
export const aiCliKindSchema = z.enum(['codex', 'claude', 'deepseek'])
export const aiCliSchema = z.strictObject({
  kind: aiCliKindSchema,
  path: z.string().max(4096),
  model: z.string().max(160),
})
export const aiBackendSchema = z.strictObject({
  kind: z.enum(['official', 'custom', 'codex', 'claude', 'deepseek']),
  providerId: id.optional(),
  model: z.string().max(160).default(''),
})
export const aiSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  providers: z.array(aiProviderSchema).max(32),
  clis: z.array(aiCliSchema).max(3),
  defaultBackend: aiBackendSchema,
})
export const aiModelCatalogSchema = z.strictObject({
  models: aiModelsSchema,
  defaultModel: z.string().max(160),
  dailyTokenLimit: z.int().nonnegative().optional(),
  remainingTokens: z.int().nonnegative().optional(),
  message: z.string().max(1024),
})
export const aiCapabilitiesSchema = aiModelCatalogSchema.extend({
  available: z.boolean(),
  dailyTokenLimit: z.int().nonnegative(),
  remainingTokens: z.int().nonnegative(),
  toolsetVersion: z.literal(AI_TOOLSET_VERSION),
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
export const aiToolCallSchema = z.strictObject({
  id,
  name: aiToolNameSchema,
  args: z.record(z.string(), z.json()),
  sessionId: id.optional(),
  state: z.enum(['pending', 'running', 'completed', 'unknown', 'rejected', 'expired', 'failed']),
  preview: z.string().max(524288).default(''),
  result: z.json().optional(),
  error: z.string().max(2048).default(''),
})
export const aiMessageSchema = z.strictObject({
  id: z.uuid(),
  role: z.enum(['user', 'assistant', 'tool']),
  text: z.string().max(196608),
  startedAt: z.int().nonnegative().optional(),
  completedAt: z.int().nonnegative().optional(),
  tool: aiToolCallSchema.optional(),
})
export const aiConversationSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().max(120),
  updatedAt: z.number(),
  backend: aiBackendSchema,
  permission: z.enum(['observer', 'confirm', 'auto']),
  revision: z.int().nonnegative(),
  targets: z.array(aiTargetSchema).max(32),
  messages: z.array(aiMessageSchema).max(2000),
  jobs: z.array(aiJobSchema).max(64),
  summary: z.string().max(32768),
  status: z.enum(['idle', 'thinking', 'awaiting_confirmation', 'executing', 'paused', 'error']),
  error: z.string().max(2048),
})
export const aiSummarySchema = aiConversationSchema.pick({
  id: true,
  title: true,
  updatedAt: true,
  backend: true,
})
export const aiAttachmentSchema = z.strictObject({
  name: z.string().min(1).max(255),
  content: z.string().max(131072),
})
const conversationId = z.strictObject({ conversationId: z.uuid() })
export const ai = {
  'ai.settings': { input: z.undefined(), output: aiSettingsSchema },
  'ai.setEnabled': { input: z.strictObject({ enabled: z.boolean() }), output: aiSettingsSchema },
  'ai.configure': {
    input: aiConnectionSchema.superRefine((value, ctx) => {
      if (value.models && !value.models.some((m) => m.id === value.model))
        ctx.addIssue({ code: 'custom', path: ['model'], message: '请从候选池中选择模型' })
      if (value.models && new Set(value.models.map((m) => m.id)).size !== value.models.length)
        ctx.addIssue({ code: 'custom', path: ['models'], message: '候选池包含重复模型' })
    }),
    output: aiSettingsSchema,
  },
  'ai.removeProvider': { input: z.strictObject({ providerId: id }), output: aiSettingsSchema },
  'ai.configureCli': { input: aiCliSchema, output: aiSettingsSchema },
  'ai.setDefault': { input: aiBackendSchema, output: aiSettingsSchema },
  'ai.capabilities': { input: z.undefined(), output: aiCapabilitiesSchema },
  'ai.discover': { input: aiDiscoverySchema, output: aiModelCatalogSchema },
  'ai.test': {
    input: aiConnectionSchema.omit({ models: true }),
    output: z.strictObject({ message: z.string().max(1024) }),
  },
  'ai.cliStatus': {
    input: z.undefined(),
    output: z
      .array(
        z.strictObject({
          kind: aiCliKindSchema,
          path: z.string(),
          available: z.boolean(),
          message: z.string(),
        }),
      )
      .max(3),
  },
  'ai.open': {
    input: z.strictObject({ sessionIds: z.array(id).min(1).max(32), backend: aiBackendSchema.optional() }),
    output: aiConversationSchema,
  },
  'ai.history': { input: z.undefined(), output: z.array(aiSummarySchema).max(100) },
  'ai.read': { input: conversationId, output: aiConversationSchema },
  'ai.remove': { input: conversationId, output: z.void() },
  'ai.scope': {
    input: conversationId.extend({ sessionIds: z.array(id).max(32) }),
    output: aiConversationSchema,
  },
  'ai.backend': { input: conversationId.extend({ backend: aiBackendSchema }), output: aiConversationSchema },
  'ai.permission': {
    input: conversationId.extend({ permission: z.enum(['observer', 'confirm', 'auto']) }),
    output: aiConversationSchema,
  },
  'ai.send': {
    input: conversationId.extend({
      text: z.string().min(1).max(16384),
      attachments: z.array(aiAttachmentSchema).max(8),
    }),
    output: z.void(),
  },
  'ai.decide': {
    input: conversationId.extend({
      callId: id,
      decision: z.enum(['once', 'conversation', 'reject']),
      revision: z.int(),
    }),
    output: z.void(),
  },
  'ai.cancel': { input: conversationId, output: z.void() },
  'ai.stopJob': { input: conversationId.extend({ jobId: id }), output: aiConversationSchema },
  'ai.output': {
    input: conversationId.extend({ handle: id, offset: z.int().nonnegative().default(0) }),
    output: z.string().max(32768),
  },
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
export type AiProvider = z.infer<typeof aiProviderSchema>
export type AiConnection = z.infer<typeof aiConnectionSchema>
export type AiBackend = z.infer<typeof aiBackendSchema>
export type AiCli = z.infer<typeof aiCliSchema>
export type AiCliStatus = z.infer<(typeof ai)['ai.cliStatus']['output']>[number]
export type AiConversation = z.infer<typeof aiConversationSchema>
export type AiToolCall = z.infer<typeof aiToolCallSchema>
export type AiTarget = z.infer<typeof aiTargetSchema>
export type AiCapabilities = z.infer<typeof aiCapabilitiesSchema>
export type AiModelCatalog = z.infer<typeof aiModelCatalogSchema>
export const aiEventSchema = z.union([
  z.strictObject({ workspaceGeneration: z.int(), conversation: aiConversationSchema }),
  z.strictObject({ workspaceGeneration: z.int(), conversationId: z.uuid(), message: aiMessageSchema }),
])
export type AiEvent = z.infer<typeof aiEventSchema>
/** Internal transport only. Renderer methods cannot supply requests. */
export const aiHttpRequestSchema = z
  .strictObject({
    source: z.enum(['official', 'custom']),
    url: aiEndpointSchema,
    method: z.enum(['GET', 'POST']),
    authorization: z
      .string()
      .max(8192)
      .refine((v) => !/[\r\n]/.test(v)),
    headers: z
      .record(
        z.string().regex(/^[a-zA-Z0-9-]+$/),
        z
          .string()
          .max(8192)
          .refine((v) => !/[\r\n]/.test(v)),
      )
      .optional(),
    body: z.string().max(524288).optional(),
  })
  .superRefine((r, ctx) => {
    const u = new URL(r.url)
    if (
      r.source === 'official' &&
      (u.origin !== 'https://eizhu.yuweinfo.com' ||
        !['/api/ai/v2/capabilities', '/api/ai/v2/responses'].includes(u.pathname))
    )
      ctx.addIssue({ code: 'custom', message: '官方AI请求地址无效' })
  })
export type AiHttpRequest = z.infer<typeof aiHttpRequestSchema>
