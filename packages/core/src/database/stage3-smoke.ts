import { parentPort, workerData } from 'node:worker_threads'
import { randomBytes, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { z } from 'zod'
import { AgentRepository, storedAiConfigSchema } from '../agent/repository.ts'
import { aiSettingsSchema, aiConversationSchema } from '@eizhu/contracts'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { FoundationStore } from './store.ts'
import { answerWorker } from '../workers/client.ts'
import { ssh } from '@eizhu/contracts'
import type { HistoryEntry } from '@eizhu/contracts/models/api'
parentPort!.on('message', async (message) =>
  parentPort!.postMessage(
    await answerWorker(message, () => {
      const root = join((workerData as { root: string }).root, 'storage'),
        key = randomBytes(32)
      let store = new FoundationStore(root, key)
      const execute = (operation: keyof typeof ssh, input: unknown) =>
        store.local.sshExecute(operation, ssh[operation].input.parse(input))
      const originalNow = Date.now
      try {
        const profile = store.local.execute('profile.create', {
          request: {
            name: '合成服务器',
            host: 'storage.example.invalid',
            username: 'synthetic',
            auth_type: 'password',
            password: 'stage3-storage-secret',
          },
        }) as { id: string }
        for (let i = 0; i < 501; i++)
          execute('history.record', {
            profileId: profile.id,
            command: 'stage3-sensitive-history-' + i,
            cwd: '/合成目录',
          })
        assert.equal((execute('history.list', { profileId: profile.id }) as HistoryEntry[]).length, 500)
        execute('history.record', {
          profileId: profile.id,
          command: 'stage3-sensitive-history-500',
          cwd: '/合成目录',
        })
        assert.equal(
          (execute('history.list', { profileId: profile.id }) as HistoryEntry[]).find(
            (h) => h.command === 'stage3-sensitive-history-500',
          )?.count,
          2,
        )
        store.local.execute('localState.write', {
          key: 'history_settings',
          value: { enabled: false, maxEntries: 500, retentionDays: 30 },
        })
        execute('history.record', { profileId: profile.id, command: 'must-not-persist', cwd: '/' })
        assert.ok(
          !(execute('history.list', { profileId: profile.id }) as HistoryEntry[]).some(
            (h) => h.command === 'must-not-persist',
          ),
        )
        const endpoint = '["storage.example.invalid",22]'
        store.local.sshExecute('ssh.trust', { endpoint, fingerprint: 'SHA256:synthetic-stage3' })
        const tunnel = execute('tunnel.save', {
          config: {
            id: '',
            name: '加密隧道',
            profile_id: profile.id,
            kind: 'dynamic',
            bind_host: '::1',
            bind_port: 0,
            target_host: 'localhost',
            target_port: 80,
          },
        }) as { id: string }
        assert.throws(() => store.local.execute('profile.delete', { id: profile.id }), /隧道/)
        assert.ok(!JSON.stringify(store.local.snapshot()).includes('stage3-sensitive-history'))
        store.close()
        const bytes = readFileSync(join(root, 'workspaces/offline/workspace.sqlite'))
        for (const secret of [
          'stage3-sensitive-history',
          'stage3-storage-secret',
          'synthetic-stage3',
          '加密隧道',
        ])
          assert.ok(!bytes.includes(Buffer.from(secret)))
        store = new FoundationStore(root, key)
        assert.equal(store.local.sshExecute('ssh.known', { endpoint }), 'SHA256:synthetic-stage3')
        assert.equal((execute('history.list', { profileId: profile.id }) as HistoryEntry[]).length, 500)
        const future = originalNow() + 31 * 86400000
        Date.now = () => future
        store.local.pruneHistory()
        assert.equal((execute('history.list', { profileId: profile.id }) as HistoryEntry[]).length, 0)
        Date.now = originalNow
        execute('tunnel.delete', { id: tunnel.id })
        store.local.execute('profile.delete', { id: profile.id })
        const aiDb = new Database(':memory:')
        let agent: AgentRepository | undefined
        try {
          aiDb.exec('CREATE TABLE local_state(key TEXT PRIMARY KEY, data BLOB NOT NULL)')
          aiDb.prepare('INSERT INTO local_state VALUES (?,?)').run('ai:config', Buffer.from('old-ai-only'))
          aiDb
            .prepare('INSERT INTO local_state VALUES (?,?)')
            .run('other-setting', Buffer.from('keep-other-setting'))
          agent = new AgentRepository(aiDb, key, 'offline')
          assert.equal(storedAiConfigSchema.parse(agent.execute({ kind: 'config.read' })).enabled, false)
          assert.equal(
            z
              .object({ n: z.number() })
              .parse(aiDb.prepare("SELECT count(*) n FROM local_state WHERE key GLOB 'ai:*'").get()).n,
            0,
          )
          const config = {
            enabled: false,
            providers: [
              {
                id: 'p',
                name: 'fixture',
                protocol: 'responses',
                endpoint: 'https://fixture.invalid/v1',
                model: 'fixture',
                contextWindow: 96000,
                models: [
                  { id: 'fixture', name: 'fixture' },
                  { id: 'ai-v2-discovered-model', name: 'ai-v2-model-label' },
                ],
                apiKey: 'ai-v2-storage-secret',
              },
            ],
            clis: [],
            defaultBackend: { kind: 'custom', providerId: 'p', model: 'fixture' },
          }
          agent.execute({ kind: 'config.write', value: config })
          const conversation = aiConversationSchema.parse({
            id: randomUUID(),
            title: 'ai-v2-storage-message',
            updatedAt: 1,
            backend: config.defaultBackend,
            permission: 'confirm',
            revision: 0,
            targets: [],
            messages: [],
            jobs: [],
            summary: '',
            status: 'idle',
            error: '',
          })
          agent.execute({ kind: 'save', value: { format: 3, conversation, wire: [], outputs: {} } })
          assert.equal((agent.execute({ kind: 'list' }) as unknown[]).length, 1)
          const rows = z
            .array(z.object({ data: z.instanceof(Buffer) }))
            .parse(aiDb.prepare('SELECT data FROM local_state').all())
          assert.ok(
            rows.every(
              (r) =>
                !r.data.includes(Buffer.from('ai-v2-storage-secret')) &&
                !r.data.includes(Buffer.from('ai-v2-storage-message')) &&
                !r.data.includes(Buffer.from('ai-v2-discovered-model')) &&
                !r.data.includes(Buffer.from('ai-v2-model-label')),
            ),
          )
          agent.close()
          agent = new AgentRepository(aiDb, key, 'offline')
          const restored = storedAiConfigSchema.parse(agent.execute({ kind: 'config.read' }))
          assert.equal(restored.providers[0].apiKey, 'ai-v2-storage-secret')
          assert.equal(restored.providers[0].contextWindow, 96000)
          assert.deepEqual(restored.providers[0].models, config.providers[0].models)
          assert.equal(restored.enabled, false)
          assert.equal((agent.execute({ kind: 'list' }) as unknown[]).length, 1)
          assert.ok(aiDb.prepare("SELECT data FROM local_state WHERE key='other-setting'").get())
          assert.ok(
            !JSON.stringify(
              aiSettingsSchema.parse({
                ...restored,
                providers: restored.providers.map(({ apiKey, ...p }) => ({
                  ...p,
                  hasApiKey: Boolean(apiKey),
                })),
              }),
            ).includes('ai-v2-storage-secret'),
          )
        } finally {
          agent?.close()
          aiDb.close()
        }
        return {
          passed: true,
          retention: '500/30d',
          aiStorageMigrationAndEncryption: true,
          disabled: true,
          encrypted: true,
          persisted: true,
          excludedFromBackup: true,
          tunnelReferenceProtected: true,
        }
      } finally {
        Date.now = originalNow
        store.close()
        key.fill(0)
      }
    }),
  ),
)
