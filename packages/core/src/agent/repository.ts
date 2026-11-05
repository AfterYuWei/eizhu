import type Database from 'better-sqlite3'
import { z } from 'zod'
import { modelMessageSchema } from 'ai'
import {
  aiConversationSchema,
  aiProviderSchema,
  aiCliSchema,
  aiBackendSchema,
  aiSummarySchema,
  fail,
} from '@eizhu/contracts'
import { LocalCipher } from '../local/crypto.ts'

export const storedProviderSchema = aiProviderSchema
  .omit({ hasApiKey: true })
  .extend({ apiKey: z.string().max(8192) })
export const storedAiConfigSchema = z.strictObject({
  enabled: z.boolean().default(true),
  providers: z.array(storedProviderSchema).max(32),
  clis: z.array(aiCliSchema).max(3),
  defaultBackend: aiBackendSchema,
})
export const storedAiConversationSchema = z.strictObject({
  format: z.literal(3),
  conversation: aiConversationSchema,
  wire: z.array(modelMessageSchema).max(1000),
  outputs: z.record(z.string(), z.strictObject({ content: z.string().max(262144), truncated: z.boolean() })),
  nativeSession: z.string().max(512).optional(),
})
export type StoredAiConversation = z.infer<typeof storedAiConversationSchema>
const storageRequest = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('config.read') }),
  z.strictObject({ kind: z.literal('config.write'), value: storedAiConfigSchema }),
  z.strictObject({ kind: z.literal('list') }),
  z.strictObject({ kind: z.literal('read'), id: z.uuid() }),
  z.strictObject({ kind: z.literal('save'), value: storedAiConversationSchema }),
  z.strictObject({ kind: z.literal('remove'), id: z.uuid() }),
])
/** All AI data is encrypted local state; no entities, outbox or backup fields. */
export class AgentRepository {
  private db: Database.Database
  private cipher: LocalCipher
  constructor(db: Database.Database, key: Uint8Array, workspace: string) {
    this.db = db
    this.cipher = new LocalCipher(key, workspace)
    this.db.transaction(() => {
      if (this.read('agent:v2:migrated') !== true) {
        this.db.prepare("DELETE FROM local_state WHERE key GLOB 'ai:*'").run()
        this.write('agent:v2:migrated', true)
      }
    })()
  }
  private read(key: string): unknown {
    const row = z
      .object({ data: z.instanceof(Buffer) })
      .optional()
      .parse(this.db.prepare('SELECT data FROM local_state WHERE key=?').get(key))
    return row ? this.cipher.open(row.data, `state:${key}`) : undefined
  }
  private write(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO local_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data')
      .run(key, this.cipher.seal(value, `state:${key}`))
  }
  execute(raw: unknown): unknown {
    const d = storageRequest.parse(raw)
    if (d.kind === 'config.read')
      return storedAiConfigSchema.parse(
        this.read('agent:v2:config') ?? {
          enabled: false,
          providers: [],
          clis: [],
          defaultBackend: { kind: 'official', model: '' },
        },
      )
    if (d.kind === 'config.write') return this.db.transaction(() => this.write('agent:v2:config', d.value))()
    if (d.kind === 'read')
      return storedAiConversationSchema.parse(
        this.read(`agent:v2:conversation:${d.id}`) ?? fail('NOT_FOUND', '对话不存在'),
      )
    const index = z
      .array(aiSummarySchema)
      .max(100)
      .parse(this.read('agent:v2:index') ?? [])
    if (d.kind === 'list') return index.sort((a, b) => b.updatedAt - a.updatedAt)
    if (d.kind === 'save') {
      const c = d.value.conversation
      if (!index.some((v) => v.id === c.id) && index.length >= 100)
        fail('AI_HISTORY_LIMIT', '已保存100个对话，请先删除部分历史')
      if (Buffer.byteLength(JSON.stringify(d.value)) > 8 * 1024 * 1024)
        fail('AI_HISTORY_LIMIT', '对话与输出超过8MiB，请新建对话')
      return this.db.transaction(() => {
        this.write(`agent:v2:conversation:${c.id}`, d.value)
        this.write('agent:v2:index', [
          aiSummarySchema.strip().parse(c),
          ...index.filter((v) => v.id !== c.id),
        ])
      })()
    }
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM local_state WHERE key=?').run(`agent:v2:conversation:${d.id}`)
      this.write(
        'agent:v2:index',
        index.filter((v) => v.id !== d.id),
      )
    })()
  }
  close(): void {
    this.cipher.close()
  }
}
