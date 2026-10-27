import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import type { BrowserWindow } from 'electron'
import type { RuntimeHost } from './runtime-host.ts'
import { signS3 } from '@eizhu/core/archive/providers'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  BackupStatus,
  BackupVersion,
  BackupSettings,
  BackupTargetMeta,
} from '@eizhu/contracts/models/backup'
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
/** Actual renderer/preload/main/network/utility/SQLite/KDF integration, using only an isolated profile and loopback servers. */
export async function verifyStage5(window: BrowserWindow, runtime: RuntimeHost, root: string) {
  const objects = new Map<string, Buffer>()
  let breakDav = false,
    loseIndexResponse = false,
    indexWrites = 0,
    s3Requests = 0
  const server = createServer(async (request, response) => {
    try {
      const parts: Buffer[] = []
      for await (const part of request) parts.push(Buffer.from(part))
      const body = Buffer.concat(parts),
        path = new URL(request.url!, 'http://127.0.0.1').pathname
      const method = request.method!
      if (path.startsWith('/bad/')) {
        response.writeHead(503).end()
        return
      }
      if (path.startsWith('/s3/')) {
        s3Requests++
        const headers: Record<string, string> = {}
        for (const key of ['if-match', 'if-none-match'])
          if (request.headers[key]) headers[key] = String(request.headers[key])
        const date = String(request.headers['x-amz-date']),
          iso =
            date.slice(0, 4) +
            '-' +
            date.slice(4, 6) +
            '-' +
            date.slice(6, 8) +
            'T' +
            date.slice(9, 11) +
            ':' +
            date.slice(11, 13) +
            ':' +
            date.slice(13, 15) +
            'Z'
        const signed = signS3(
          new URL(request.url!, `http://${request.headers.host}`),
          method,
          body,
          'stage5-access',
          'stage5-s3-secret',
          'test-region',
          new Date(iso),
          headers,
        )
        assert.equal(request.headers.authorization, signed.authorization)
      } else
        assert.equal(
          request.headers.authorization,
          'Basic ' + Buffer.from('stage5-user:stage5-dav-secret').toString('base64'),
        )
      if (method === 'MKCOL') {
        response.writeHead(201).end()
        return
      }
      if (method === 'GET') {
        const bytes = objects.get(path)
        if (!bytes) {
          response.writeHead(404).end()
          return
        }
        response.writeHead(200, { etag: '"' + sha(bytes) + '"' }).end(bytes)
        return
      }
      if (method === 'DELETE') {
        objects.delete(path)
        response.writeHead(204).end()
        return
      }
      if (method === 'PUT') {
        const existing = objects.get(path),
          etag = existing ? '"' + sha(existing) + '"' : undefined
        if (
          (request.headers['if-none-match'] === '*' && existing) ||
          (request.headers['if-match'] && request.headers['if-match'] !== etag)
        ) {
          response.writeHead(412).end()
          return
        }
        if (breakDav && path.startsWith('/dav/') && path.endsWith('index.json')) {
          response.writeHead(412).end()
          return
        }
        objects.set(path, body)
        if (path.endsWith('index.json')) {
          indexWrites++
          if (loseIndexResponse && path.startsWith('/dav/')) {
            loseIndexResponse = false
            request.socket.destroy()
            return
          }
        }
        response.writeHead(201, { etag: '"' + sha(body) + '"' }).end()
        return
      }
      response.writeHead(405).end()
    } catch {
      response.writeHead(500).end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`
  const call = async <T>(method: string, input?: unknown): Promise<T> => {
    const result = await window.webContents.executeJavaScript(
      `window.eizhu.backup[${JSON.stringify(method)}](${input === undefined ? '' : JSON.stringify(input)}).then(value=>({value}),e=>({failure:{code:e.code,message:e.message}}))`,
    )
    if (result.failure) throw Object.assign(new Error(result.failure.message), { code: result.failure.code })
    return result.value as T
  }
  const wait = async () => {
    for (let i = 0; i < 300; i++) {
      const state = await call<BackupStatus>('status')
      if (state.status !== 'syncing') return state
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error('Stage5 push timed out')
  }
  try {
    await assert.rejects(call('backupNow'), /密码/)
    let settings = await call<BackupSettings>('getSettings')
    await call('updateSettings', { settings, backupPassword: 'stage5-backup-密码' })
    console.log('EIZHU_STAGE5_STEP password-ready')
    const first = await call<{ created: boolean; version: BackupVersion }>('backupNow')
    assert.equal(first.created, true)
    const duplicate = await call<{ created: boolean; version: BackupVersion }>('backupNow')
    assert.equal(duplicate.created, false)
    assert.equal(first.version.id, duplicate.version.id)
    console.log('EIZHU_STAGE5_STEP dedup-passed')
    const good = await call<BackupTargetMeta>('createProvider', {
      config: {
        type: 'webdav',
        name: '阶段 5 WebDAV 合成目标',
        enabled: true,
        endpoint: base + '/dav',
        username: 'stage5-user',
        password: 'stage5-dav-secret',
      },
    })
    const bad = await call<BackupTargetMeta>('createProvider', {
      config: {
        type: 'webdav',
        name: '阶段 5 故障目标',
        enabled: true,
        endpoint: base + '/bad',
        username: 'stage5-user',
        password: 'stage5-dav-secret',
      },
    })
    const s3 = await call<BackupTargetMeta>('createProvider', {
      config: {
        type: 's3',
        name: '阶段 5 S3 合成目标',
        enabled: true,
        s3_endpoint: base + '/s3',
        s3_bucket: 'bucket',
        s3_region: 'test-region',
        s3_access_key: 'stage5-access',
        s3_secret_key: 'stage5-s3-secret',
      },
    })
    await call('testProvider', { id: good.id })
    await call('testProvider', { id: s3.id })
    assert.equal(
      [...objects.keys()].some((k) => k.includes('probe-')),
      false,
    )
    const targets = await call<BackupTargetMeta[]>('targets')
    assert.equal(JSON.stringify(targets).includes('secret'), false)
    console.log('EIZHU_STAGE5_STEP submit-latest')
    await call('submitLatest')
    assert.equal((await wait()).status, 'error')
    let versions = await call<BackupVersion[]>('versions')
    assert.ok(versions[0].synced_to.includes(good.id) && versions[0].synced_to.includes(s3.id))
    assert.ok(!versions[0].synced_to.includes(bad.id))
    await call('updateProvider', { id: bad.id, config: { type: 'webdav', name: bad.name, enabled: false } })
    const writesBefore = indexWrites
    console.log('EIZHU_STAGE5_STEP submit-latest')
    await call('submitLatest')
    assert.equal((await wait()).status, 'idle')
    assert.equal(indexWrites, writesBefore)
    await window.webContents.executeJavaScript(
      "window.eizhu.group.create({request:{name:'阶段 5 本地变更'}})",
    )
    const second = await call<{ version: BackupVersion }>('backupNow')
    breakDav = true
    console.log('EIZHU_STAGE5_STEP submit-latest')
    await call('submitLatest')
    assert.equal((await wait()).status, 'error')
    versions = await call('versions')
    assert.equal(versions[0].version, second.version.version)
    assert.ok(!versions[0].synced_to.includes(good.id))
    assert.ok(versions[0].synced_to.includes(s3.id),JSON.stringify(await call('events',{limit:5})))
    breakDav = false
    loseIndexResponse = true
    console.log('EIZHU_STAGE5_STEP submit-latest')
    await call('submitLatest')
    assert.equal((await wait()).status, 'error')
    versions = await call('versions')
    assert.ok(!versions[0].synced_to.includes(good.id))
    console.log('EIZHU_STAGE5_STEP submit-latest')
    await call('submitLatest')
    assert.equal((await wait()).status, 'idle')
    versions = await call('versions')
    assert.ok(versions[0].synced_to.includes(good.id))
    const cloud = await call<Array<{ object: string }>>('cloudVersions', { providerId: good.id })
    assert.equal(cloud.length, 2)
    const preview = await call<{ token: string; source: { kind: string } }>('previewCloud', {
      providerId: good.id,
      object: cloud[0].object,
    })
    assert.equal(preview.source.kind, 'cloud')
    await window.webContents.executeJavaScript(
      "window.eizhu.group.create({request:{name:'阶段 5 预览后变更'}})",
    )
    await assert.rejects(call('applyRestore', { token: preview.token, mode: 'merge' }), /变化|预览/)
    await assert.rejects(call('previewVersion', { id: first.version.id, password: 'wrong-password' }), /密码/)
    const localPreview = await call<{ token: string }>('previewVersion', { id: first.version.id })
    await call('applyRestore', { token: localPreview.token, mode: 'merge' })
    assert.ok((await call<unknown[]>('safetyVersions')).length > 0)
    // Restore preservation does not import cloud credentials or scheduling state.
    assert.equal((await call<BackupTargetMeta[]>('targets')).length, 3)
    const oauth = await call<BackupTargetMeta>('createProvider', {
      config: {
        type: 'gdrive',
        name: '阶段 5 OAuth 合成客户端',
        enabled: false,
        oauth_client_id: 'stage5-synthetic-client',
      },
    })
    const auth = new URL(
      (await call<{ url: string }>('oauthUrl', { providerType: 'gdrive', providerId: oauth.id })).url,
    )
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256')
    const callback = new URL(auth.searchParams.get('redirect_uri')!)
    callback.search = 'state=untrusted&code=synthetic'
    assert.equal((await fetch(callback)).status, 400)
    await call('deleteProvider', { id: oauth.id })
    await assert.rejects(fetch(callback))
    await call('updateProvider', {
      id: good.id,
      config: { type: 'webdav', name: good.name, enabled: true, endpoint: base + '/dav-new' },
    })
    assert.ok((await call<BackupVersion[]>('versions')).every((v) => !v.synced_to.includes(good.id)))
    settings = await call('getSettings')
    await call('updateSettings', {
      settings: { ...settings, auto_backup_enabled: true, change_debounce_seconds: 1, sync_mode: 'manual' },
      backupPassword: 'stage5-rotated-password',
    })
    await window.webContents.executeJavaScript(
      "window.eizhu.group.create({request:{name:'阶段 5 自动备份'}})",
    )
    for (let i = 0; i < 120; i++) {
      versions = await call('versions')
      if (versions[0].origin === 'change') break
      await new Promise((r) => setTimeout(r, 50))
    }
    assert.equal(versions[0].origin, 'change')
    await runtime.call('runtime.beforeQuit')
    assert.equal(
      (await call<{ backup_password: string }>('revealPassword')).backup_password,
      'stage5-rotated-password',
    )
    await call('previewVersion', { id: first.version.id, password: 'stage5-backup-密码' })
    await call('updateSettings', {
      settings: {
        ...(await call<BackupSettings>('getSettings')),
        auto_backup_enabled: false,
        local_keep_versions: 2,
      },
    })
    // Only ciphertext may reach SQLite; include WAL because this is the live production database Worker.
    for (const suffix of ['', '-wal']) {
      const bytes = await readFile(join(root, 'workspaces/offline/workspace.sqlite') + suffix)
      for (const secret of [
        'stage5-dav-secret',
        'stage5-s3-secret',
        'stage5-rotated-password',
        'stage5-backup-密码',
      ])
        assert.ok(!bytes.includes(Buffer.from(secret)))
    }
    // Capture the real settings surface after data hydration, without exposing configured secrets.
    await window.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,shiftKey:true,bubbles:true}))`,
    )
    for (let i = 0; i < 100; i++) {
      const ready = await window.webContents.executeJavaScript(
        `(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='数据备份');if(tab){tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true}return false})()`,
      )
      if (ready) break
      await new Promise((r) => setTimeout(r, 50))
    }
    for (let i = 0; i < 100; i++) {
      if (await window.webContents.executeJavaScript(`!!document.querySelector('#backup-password')`)) break
      await new Promise((r) => setTimeout(r, 50))
    }
    assert.equal(
      await window.webContents.executeJavaScript(
        `document.body.innerText.includes('第三方云备份无需登录账号')`,
      ),
      true,
    )
    await writeFile(join(root, 'stage5-backup.png'), (await window.webContents.capturePage()).toPNG())
    await window.webContents.executeJavaScript(`document.querySelector('.settings-page-back').click()`)
    assert.ok(s3Requests > 0)
    const legacy = await window.webContents.executeJavaScript(
      "Promise.all([window.eizhu.account.setSyncEnabled({enabled:true}).then(()=>false,e=>e.code==='ACCOUNT_NOT_LOGGED_IN'),window.eizhu.sync.status().then(s=>!s.initialized),window.eizhu.backup.previewLegacyAccount({password:'synthetic'}).then(()=>false,e=>e.code==='STAGE_NOT_READY')])",
    )
    assert.deepEqual(legacy, [true, true, true])
    return {
      passed: true,
      localVersions: true,
      dedup: true,
      encryptedStorage: true,
      webdav: true,
      s3SigV4: true,
      independentTargets: true,
      conditionalIndex: true,
      unknownResultManualRecovery: true,
      cloudPreview: true,
      stalePreviewRejected: true,
      passwordRotation: true,
      changeScheduler: true,
      shutdownBarrier: true,
      oauthPkceCallback: true,
      officialDeferred: true,
      persistedVersionId: versions[0].id,
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
