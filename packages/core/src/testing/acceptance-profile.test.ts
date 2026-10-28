import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cloneAcceptanceProfile } from './acceptance-profile.ts'

test('acceptance resume copies only an identified, stopped pre-key test profile', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'eizhu-live-sync-')),
    destination = await mkdtemp(join(tmpdir(), 'eizhu-resume-destination-')),
    source = join(parent, 'profile')
  try {
    for (const label of ['device-a', 'device-b']) {
      await mkdir(join(source, label), { recursive: true })
      await writeFile(join(source, label, 'opaque-test-data'), 'synthetic-encrypted-placeholder')
    }
    const report = {
      mode: 'live',
      passed: false,
      phase: 'initial-preview',
      clients: [
        {
          actor: 'device-a',
          pushCount: 0,
          responses: [
            { path: '/api/auth/register', status: 200, method: 'POST' },
            { path: '/api/auth/email/verify', status: 200, method: 'POST' },
            { path: '/api/sync/v2/capabilities', status: 403, method: 'GET' },
          ],
        },
        { actor: 'device-b', pushCount: 0, responses: [] },
      ],
    }
    await writeFile(join(source, 'failure.json'), JSON.stringify(report))
    assert.match(await cloneAcceptanceProfile(source, destination), /^[a-f0-9]{64}$/)
    await assert.rejects(cloneAcceptanceProfile(source, destination, 'local'), /尚未创建同步密钥/)
    assert.equal(
      await readFile(join(destination, 'device-a', 'opaque-test-data'), 'utf8'),
      'synthetic-encrypted-placeholder',
    )
    await assert.rejects(cloneAcceptanceProfile(parent, destination), /临时验收目录/)
    report.clients[0].responses.push({ path: '/api/sync/v2/keys', method: 'PUT', status: 200 })
    await writeFile(join(source, 'failure.json'), JSON.stringify(report))
    await assert.rejects(cloneAcceptanceProfile(source, destination), /已有同步写入/)
    report.clients[0].responses.pop()
    await writeFile(join(source, 'failure.json'), JSON.stringify(report))
    await writeFile(join(source, 'device-a', 'global.sqlite-wal'), 'active-wal')
    await assert.rejects(cloneAcceptanceProfile(source, join(destination, 'incomplete')), /尚未关闭/)
  } finally {
    await rm(parent, { recursive: true, force: true })
    await rm(destination, { recursive: true, force: true })
  }
})
