import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import type { BrowserWindow } from 'electron'
import type { RuntimeHost } from './runtime-host.ts'
import { signS3 } from '@eizhu/core/archive/providers'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type {
  BackupSettings,
  BackupPreferences,
  BackupStatus,
  BackupTargetMeta,
} from '@eizhu/contracts/models/backup'
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
/** Isolated native end-to-end evidence: ordinary backup files, cloud copies, unchanged legacy cloud data and scheduling. */
export async function verifyStage5(window: BrowserWindow, runtime: RuntimeHost, root: string) {
  const objects = new Map<string, Buffer>(),
    requests: Array<{ method: string; path: string }> = []
  const protectedObjects = new Map<string, Buffer>()
  let loseDavResponse = false
  const server = createServer(async (request, response) => {
    try {
      const parts: Buffer[] = []
      for await (const part of request) parts.push(Buffer.from(part))
      const body = Buffer.concat(parts),
        path = new URL(request.url!, 'http://127.0.0.1').pathname
      const method = request.method!
      requests.push({ method, path })
      if (protectedObjects.has(path)) {
        response.writeHead(500).end()
        return
      }
      if (path.startsWith('/bad/')) {
        response.writeHead(503).end()
        return
      }
      if (path.startsWith('/s3/')) {
        const headers: Record<string, string> = {}
        for (const key of ['if-match', 'if-none-match'])
          if (request.headers[key]) headers[key] = String(request.headers[key])
        const date = String(request.headers['x-amz-date'])
        const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`
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
        response.writeHead(200, { etag: `"${sha(bytes)}"` }).end(bytes)
        return
      }
      if (method === 'DELETE') {
        objects.delete(path)
        response.writeHead(204).end()
        return
      }
      if (method === 'PUT') {
        if (request.headers['if-none-match'] === '*' && objects.has(path)) {
          response.writeHead(412).end()
          return
        }
        objects.set(path, body)
        if (loseDavResponse && path.startsWith('/dav/')) {
          loseDavResponse = false
          request.socket.destroy()
          return
        }
        response.writeHead(201).end()
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
  const base = `http://127.0.0.1:${address.port}`,
    directory = join(root, 'automatic-backups')
  await mkdir(directory, { recursive: true })
  const call = async <T>(method: string, input?: unknown): Promise<T> => {
    const result = await window.webContents.executeJavaScript(
      `window.eizhu.backup[${JSON.stringify(method)}](${input === undefined ? '' : JSON.stringify(input)}).then(value=>({value}),error=>({failure:{code:error.code,message:error.message}}))`,
    )
    if (result.failure) throw Object.assign(new Error(result.failure.message), { code: result.failure.code })
    return result.value as T
  }
  const preferences = (settings: BackupSettings): BackupPreferences => {
    const {
      auto_backup_enabled,
      scheduled_enabled,
      scheduled_daily_time,
      scheduled_interval_hours,
      change_debounce_seconds,
    } = settings
    return {
      auto_backup_enabled,
      scheduled_enabled,
      scheduled_daily_time,
      scheduled_interval_hours,
      change_debounce_seconds,
    }
  }
  try {
    await assert.rejects(call('backupNow'), /目录/)
    // The test host substitutes the result of a native directory picker; renderer settings cannot supply paths.
    await runtime.call('backup.setDirectory', { directory })
    await assert.rejects(call('backupNow'), /密码/)
    const settings = await call<BackupSettings>('getSettings')
    await call('updateSettings', { settings: preferences(settings), backupPassword: 'stage5-backup-密码' })
    const first = await call<{ path: string; uploaded: number; failed: number }>('backupNow')
    assert.equal(first.uploaded, 0)
    assert.equal(first.failed, 0)
    assert.equal(basename(first.path).endsWith('.eizhubackup'), true)
    const firstBytes = await readFile(first.path)
    assert.ok(!firstBytes.includes(Buffer.from('stage5-backup-密码')))
    const preview = await runtime.call<{ credential_mode: string }>('backup.granted', {
      operation: 'backup.preview',
      input: { filePath: first.path, password: 'stage5-backup-密码' },
    })
    assert.equal(preview.credential_mode, 'encrypted')
    await runtime.call('backup.granted', {
      operation: 'backup.import',
      input: { filePath: first.path, password: 'stage5-backup-密码', strategy: 'skip' },
    })
    console.log('EIZHU_STAGE5_STEP local-file-importable')
    const good = await call<BackupTargetMeta>('createProvider', {
      config: {
        type: 'webdav',
        name: '合成 WebDAV',
        enabled: true,
        endpoint: base + '/dav',
        username: 'stage5-user',
        password: 'stage5-dav-secret',
      },
    })
    const s3 = await call<BackupTargetMeta>('createProvider', {
      config: {
        type: 's3',
        name: '合成 S3',
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
    for (const prefix of ['/dav/', '/s3/']) {
      const path = requests
        .find((r) => r.path.startsWith(prefix) && r.path.includes('probe-'))!
        .path.replace(/[^/]+$/, '')
      for (const name of ['index.json', 'v000001-0123456789ab.eizhubackup']) {
        const bytes = Buffer.from(`existing-cloud-object:${name}`)
        protectedObjects.set(path + name, bytes)
        objects.set(path + name, bytes)
      }
    }
    const both = await call<{ path: string; uploaded: number; failed: number }>('backupNow')
    assert.equal(both.uploaded, 2)
    assert.equal(both.failed, 0)
    assert.notEqual(both.path, first.path)
    for (const prefix of ['/dav/', '/s3/']) {
      const uploaded = [...objects].find(
        ([path]) => path.startsWith(prefix) && path.endsWith(basename(both.path)),
      )!
      assert.deepEqual(uploaded[1], await readFile(both.path))
    }
    const bad = await call<BackupTargetMeta>('createProvider', {
      config: {
        type: 'webdav',
        name: '合成故障目标',
        enabled: true,
        endpoint: base + '/bad',
        username: 'stage5-user',
        password: 'stage5-dav-secret',
      },
    })
    const partial = await call<{ path: string; uploaded: number; failed: number }>('backupNow')
    assert.equal(partial.uploaded, 2)
    assert.equal(partial.failed, 1)
    assert.ok((await call<BackupStatus>('status')).last_error?.includes('本地备份已保存'))
    await call('deleteProvider', { id: bad.id })
    loseDavResponse = true
    const unknown = await call<{ path: string; uploaded: number; failed: number }>('backupNow')
    assert.equal(unknown.failed, 1)
    assert.equal(
      requests.filter(
        (r) => r.method === 'PUT' && r.path.startsWith('/dav/') && r.path.endsWith(basename(unknown.path)),
      ).length,
      1,
      'Unknown uploads are never replayed',
    )
    assert.ok(await readFile(unknown.path))
    await call('updateSettings', {
      settings: { ...preferences(settings), auto_backup_enabled: true, change_debounce_seconds: 1 },
    })
    const beforeChange = (await readdir(directory)).length
    await window.webContents.executeJavaScript("window.eizhu.group.create({request:{name:'自动备份触发'}})")
    for (let i = 0; i < 200 && (await readdir(directory)).length === beforeChange; i++)
      await new Promise((resolve) => setTimeout(resolve, 50))
    assert.ok((await readdir(directory)).length > beforeChange)
    for (let i = 0; i < 100 && (await call<BackupStatus>('status')).status === 'backing_up'; i++)
      await new Promise((resolve) => setTimeout(resolve, 50))
    await runtime.call('runtime.beforeQuit')
    const last = await call<BackupStatus>('status')
    assert.ok(last.last_backup_path)
    assert.ok(await readFile(last.last_backup_path))
    await call('updateSettings', { settings: { ...preferences(settings), auto_backup_enabled: false } })
    for (const [path, bytes] of protectedObjects) {
      assert.deepEqual(objects.get(path), bytes)
      assert.equal(
        requests.some((r) => r.path === path),
        false,
        'Already uploaded backup files and indices must never be accessed',
      )
    }
    assert.equal(
      requests.some((r) => r.method === 'DELETE' && r.path.endsWith('.eizhubackup')),
      false,
    )
    for (const suffix of ['', '-wal']) {
      const bytes = await readFile(join(root, 'workspaces/offline/workspace.sqlite') + suffix)
      for (const secret of ['stage5-dav-secret', 'stage5-s3-secret', 'stage5-backup-密码'])
        assert.ok(!bytes.includes(Buffer.from(secret)))
    }
    await window.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,shiftKey:true,bubbles:true}))`,
    )
    for (let i = 0; i < 100; i++) {
      if (
        await window.webContents.executeJavaScript(
          `(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='数据备份');if(!tab)return false;tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true})()`,
        )
      )
        break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    for (
      let i = 0;
      i < 100 &&
      !(await window.webContents.executeJavaScript(`!!document.querySelector('#backup-password')`));
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(
      await window.webContents.executeJavaScript(
        `document.body.innerText.includes('版本恢复')||document.body.innerText.includes('保留版本数')`,
      ),
      false,
    )
    await writeFile(join(root, 'stage5-backup.png'), (await window.webContents.capturePage()).toPNG())
    await window.webContents.executeJavaScript(`document.querySelector('.settings-page-back').click()`)
    return {
      passed: true,
      localFiles: true,
      encryptedImportableFiles: true,
      webdav: true,
      s3SigV4: true,
      independentTargets: true,
      unknownUploadNotReplayed: true,
      existingCloudObjectsUntouched: true,
      changeScheduler: true,
      shutdownBackup: true,
      noVersionApis: true,
      persistedPath: last.last_backup_path,
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
