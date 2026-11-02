import type Database from 'better-sqlite3'
import { z } from 'zod'
import { aiConversationSchema, aiPreferencesSchema, aiSummarySchema, fail } from '@eizhu/contracts'
import { LocalCipher } from '../local/crypto.ts'

export const storedAiConfigSchema = aiPreferencesSchema.extend({ apiKey: z.string().max(8192) })
export const storedAiConversationSchema = z.strictObject({
  format: z.literal(2).optional(),
  conversation: aiConversationSchema,
  wire: z.array(z.json()).max(400),
})
export type StoredAiConversation = z.infer<typeof storedAiConversationSchema>
const storageRequest = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('config.read') }),
  z.strictObject({ kind: z.literal('config.write'), value: storedAiConfigSchema }),
  z.strictObject({ kind: z.literal('list'), profileId: z.string().min(1).max(160) }),
  z.strictObject({ kind: z.literal('read'), id: z.uuid() }),
  z.strictObject({ kind: z.literal('save'), value: storedAiConversationSchema }),
  z.strictObject({
    kind: z.literal('remove'),
    profileId: z.string().min(1).max(160),
    id: z.uuid().optional(),
  }),
])

/** Uses existing encrypted local_state; never creates an entity/outbox or changes backup payloads. */
export class AgentRepository {
  private db: Database.Database
  private cipher: LocalCipher
  constructor(db: Database.Database, key: Uint8Array, workspace: string) {
    this.db = db
    this.cipher = new LocalCipher(key, workspace)
  }
  private read(key: string): unknown {
    const row = this.db.prepare('SELECT data FROM local_state WHERE key=?').get(key) as
      { data: Buffer } | undefined
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
      return storedAiConfigSchema.strip().parse(
        this.read('ai:config') ?? {
          source: 'official',
          endpoint: '',
          model: '',
          apiKey: '',
        },
      )
    if (d.kind === 'config.write') return this.db.transaction(() => this.write('ai:config', d.value))()
    if (d.kind === 'read')
      return storedAiConversationSchema.parse(
        this.read(`ai:conversation:${d.id}`) ?? fail('NOT_FOUND', '对话不存在'),
      )
    const index = z
      .array(aiSummarySchema)
      .max(100)
      .parse(this.read('ai:index') ?? [])
    if (d.kind === 'list')
      return index.filter((c) => c.profileId === d.profileId).sort((a, b) => b.updatedAt - a.updatedAt)
    if (d.kind === 'save') {
      const c = d.value.conversation
      if (!index.some((v) => v.id === c.id) && index.length >= 100)
        fail('AI_HISTORY_LIMIT', '已保存 100 个对话，请先删除部分历史')
      if (Buffer.byteLength(JSON.stringify(d.value)) > 8 * 1024 * 1024)
        fail('AI_HISTORY_LIMIT', '当前对话已满，请新建对话')
      return this.db.transaction(() => {
        this.write(`ai:conversation:${c.id}`, d.value)
        const { id, profileId, title, updatedAt, source, model } = c
        this.write('ai:index', [
          aiSummarySchema.parse({ id, profileId, title, updatedAt, source, model }),
          ...index.filter((v) => v.id !== c.id),
        ])
      })()
    }
    return this.db.transaction(() => {
      for (const c of index.filter((v) => v.profileId === d.profileId && (!d.id || v.id === d.id)))
        this.db.prepare('DELETE FROM local_state WHERE key=?').run(`ai:conversation:${c.id}`)
      this.write(
        'ai:index',
        index.filter((v) => v.profileId !== d.profileId || (d.id && v.id !== d.id)),
      )
    })()
  }
  close(): void {
    this.cipher.close()
  }
}
