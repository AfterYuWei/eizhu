import { parentPort, workerData } from 'node:worker_threads'
import { randomBytes } from 'node:crypto'
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
        return {
          passed: true,
          retention: '500/30d',
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
