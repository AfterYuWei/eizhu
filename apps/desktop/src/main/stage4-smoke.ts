import assert from 'node:assert/strict'
import { Server, utils } from 'ssh2'
import type { Connection, SFTPWrapper } from 'ssh2'
import type { BrowserWindow } from 'electron'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile, readFile, stat, readdir, realpath, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { displayPath } from '@eizhu/core/sftp/endpoint'
import type { RuntimeHost } from './runtime-host.ts'
import type { Windows } from './windows.ts'

function legacyFiles(sftp: SFTPWrapper) {
  const files = new Map<string, Buffer>([['/legacy.txt', Buffer.from('原文件必须保留')]])
  const attributes = (path: string) => ({
    mode: path === '/' ? 0o40755 : 0o100640,
    size: files.get(path)?.length ?? 0,
    mtime: 1700000000,
    atime: 1700000000,
    uid: 1000,
    gid: 1000,
  })
  sftp.on('REALPATH', (id: number) =>
    sftp.name(id, [{ filename: '/', longname: '/', attrs: attributes('/') }]),
  )
  const stat = (id: number, path: string) => {
    if (path === '/' || files.has(path)) sftp.attrs(id, attributes(path))
    else sftp.status(id, 2)
  }
  sftp.on('LSTAT', stat)
  sftp.on('STAT', stat)
  sftp.on('OPEN', (id: number, path: string, flags: number) => {
    if (flags & 8) {
      if (files.has(path) && flags & 32) {
        sftp.status(id, 4)
        return
      }
      if (!files.has(path)) files.set(path, Buffer.alloc(0))
    }
    if (!files.has(path)) {
      sftp.status(id, 2)
      return
    }
    sftp.handle(id, Buffer.from(path))
  })
  sftp.on('READ', (id: number, handle: Buffer, offset: number, length: number) => {
    const data = files.get(handle.toString())?.subarray(offset, offset + length)
    if (data?.length) sftp.data(id, data)
    else sftp.status(id, 1)
  })
  sftp.on('WRITE', (id: number, handle: Buffer, offset: number, data: Buffer) => {
    const path = handle.toString(),
      old = files.get(path) ?? Buffer.alloc(0),
      next = Buffer.alloc(Math.max(old.length, offset + data.length))
    old.copy(next)
    data.copy(next, offset)
    files.set(path, next)
    sftp.status(id, 0)
  })
  sftp.on('CLOSE', (id: number) => sftp.status(id, 0))
  sftp.on('SETSTAT', (id: number) => sftp.status(id, 0))
  sftp.on('REMOVE', (id: number, path: string) => {
    files.delete(path)
    sftp.status(id, 0)
  })
  sftp.on('RENAME', (id: number, from: string, to: string) => {
    if (files.has(to) || !files.has(from)) {
      sftp.status(id, 4)
      return
    }
    files.set(to, files.get(from)!)
    files.delete(from)
    sftp.status(id, 0)
  })
  sftp.on('error', () => undefined)
}

/** Local OpenSSH file subsystem behind a synthetic SSH peer; never uses the user's servers or keys. */
export async function verifyStage4(
  window: BrowserWindow,
  runtime: RuntimeHost,
  windows: Windows,
  root: string,
  assets: string,
) {
  const step = (name: string) => console.log('EIZHU_STAGE4_STEP', name)
  const executable = [
    '/usr/libexec/sftp-server',
    '/usr/lib/openssh/sftp-server',
    '/usr/lib/ssh/sftp-server',
  ].find(existsSync)
  if (!executable)
    return {
      passed: false,
      unavailable: true,
      reason: '本机缺少 OpenSSH sftp-server，阶段 4 协议集成待验',
      restoredTaskId: '',
    }
  const directory = join(await realpath(root), 'stage4'),
    remote = join(directory, 'remote'),
    local = join(directory, 'local')
  await mkdir(join(remote, 'source', 'empty'), { recursive: true })
  await mkdir(join(remote, 'dest'))
  await mkdir(local)
  await writeFile(join(remote, 'source', '配置.json'), '开场\r\n', { mode: 0o640 })
  await chmod(join(remote, 'source', '配置.json'), 0o640)
  await writeFile(join(remote, 'source', 'binary'), Buffer.from([0, 255, 0]))
  await writeFile(join(remote, 'source', 'large.bin'), Buffer.alloc(2 * 1024 * 1024 + 17, 91))
  const host = utils.generateKeyPairSync('ed25519'),
    clients = new Set<Connection>(),
    children = new Set<ChildProcessWithoutNullStreams>()
  const server = new Server({ hostKeys: [host.private] }, (client) => {
    let username = ''
    clients.add(client)
    client.on('error', () => undefined)
    client.once('close', () => clients.delete(client))
    client.on('authentication', (ctx) => {
      username = ctx.username
      if (ctx.method === 'password' && ctx.password === 'synthetic-stage4') ctx.accept()
      else ctx.reject()
    })
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept()
        if (username === 'legacy') {
          session.on('sftp', (accept) => legacyFiles(accept()))
          return
        }
        session.on('subsystem', (accept, reject, info) => {
          if (info.name !== 'sftp') {
            reject()
            return
          }
          const channel = accept(),
            child = spawn(executable, ['-d', remote], { stdio: 'pipe' })
          children.add(child)
          child.on('error', () => channel.destroy())
          child.stderr.on('data', () => undefined)
          child.once('close', () => {
            children.delete(child)
            channel.end()
          })
          channel.on('error', () => undefined)
          channel.once('close', () => child.kill())
          channel.pipe(child.stdin)
          child.stdout.pipe(channel)
        })
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const call = <T = unknown>(operation: string, input?: unknown): Promise<T> =>
    window.webContents.executeJavaScript(
      `window.eizhu.${operation}(${input === undefined ? '' : JSON.stringify(input)})`,
    )
  let profileId = '',
    sessionId = '',
    localId = '',
    legacyProfile = '',
    legacySession = ''
  const wait = async <T>(work: () => Promise<T | undefined>, timeout = 15000): Promise<T> => {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      const result = await work()
      if (result !== undefined) return result
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    throw new Error('Stage4 wait timeout')
  }
  const completed = async (id: string) =>
    wait(async () => {
      const t = (
        await call<Array<{ id: string; status: string; error_message?: string }>>('sftp.listTransfers', {})
      ).find((t) => t.id === id)
      if (t?.status === 'failed') throw new Error(t.error_message)
      return t?.status === 'completed' ? true : undefined
    })
  try {
    const profile = await call<{ id: string }>('profile.create', {
      request: {
        name: '阶段 4 合成服务器',
        host: '127.0.0.1',
        port: (server.address() as { port: number }).port,
        username: 'synthetic',
        auth_type: 'password',
        password: 'synthetic-stage4',
      },
    })
    profileId = profile.id
    const created = await call<{ session_id: string }>('sftp.createSession', { profileId })
    sessionId = created.session_id
    let prompted = false
    await wait(async () => {
      const info = await call<{
        status: string
        host_key_request_id?: string
        host_key_fingerprint?: string
        error?: string
      }>('sftp.getSession', { id: sessionId })
      if (info.status === 'error') throw new Error(info.error)
      if (info.host_key_request_id) {
        prompted = true
        const bad = await call('sftp.hostKeyDecide', {
          requestId: info.host_key_request_id,
          fingerprint: 'wrong',
          decision: 'trust_once',
        }).then(
          () => false,
          () => true,
        )
        assert.equal(bad, true)
        await call('sftp.hostKeyDecide', {
          requestId: info.host_key_request_id,
          fingerprint: info.host_key_fingerprint,
          decision: 'trust_permanently',
        })
      }
      return info.status === 'connected' ? true : undefined
    })
    assert.equal(prompted, true)
    step('openssh-connected')
    localId = (await call<{ session_id: string }>('sftp.createSession', { profileId: 'local' })).session_id
    const source = displayPath(join(remote, 'source')),
      dest = displayPath(join(remote, 'dest')),
      localPath = displayPath(local),
      file = source + '/配置.json'
    const listing = await call<{ entries: Array<{ name: string }> }>('sftp.list', {
      sessionId,
      path: source,
      showHidden: false,
    })
    assert.ok(listing.entries.some((e) => e.name === '配置.json'))
    await call('sftp.mkdir', { sessionId, path: dest + '/new' })
    await call('sftp.rename', { sessionId, oldPath: dest + '/new', newPath: dest + '/renamed' })
    const opened = await call<{ mod_time: string; content_hash: string; content: string }>('sftp.readFile', {
      sessionId,
      path: file,
    })
    assert.equal(opened.content, '开场\r\n')
    await call('sftp.writeFile', {
      sessionId,
      path: file,
      request: {
        content: '安全保存\n',
        line_ending: 'crlf',
        expected_mod_time: opened.mod_time,
        expected_content_hash: opened.content_hash,
      },
    })
    assert.equal(await readFile(join(remote, 'source', '配置.json'), 'utf8'), '安全保存\r\n')
    assert.equal((await stat(join(remote, 'source', '配置.json'))).mode & 0o777, 0o640)
    await assert.rejects(
      call('sftp.writeFile', {
        sessionId,
        path: file,
        request: {
          content: 'stale',
          expected_mod_time: opened.mod_time,
          expected_content_hash: opened.content_hash,
        },
      }),
    )
    await assert.rejects(call('sftp.readFile', { sessionId, path: source + '/binary' }))
    const legacy = await call<{ id: string }>('profile.create', {
      request: {
        name: '阶段 4 不支持原子替换的合成服务器',
        host: '127.0.0.1',
        port: (server.address() as { port: number }).port,
        username: 'legacy',
        auth_type: 'password',
        password: 'synthetic-stage4',
      },
    })
    legacyProfile = legacy.id
    legacySession = (await call<{ session_id: string }>('sftp.createSession', { profileId: legacyProfile }))
      .session_id
    await wait(async () =>
      (await call<{ status: string }>('sftp.getSession', { id: legacySession })).status === 'connected'
        ? true
        : undefined,
    )
    const original = await call<{ mod_time: string; content_hash: string }>('sftp.readFile', {
      sessionId: legacySession,
      path: '/legacy.txt',
    })
    const unsupported = await call('sftp.writeFile', {
      sessionId: legacySession,
      path: '/legacy.txt',
      request: {
        content: '不可覆盖',
        expected_mod_time: original.mod_time,
        expected_content_hash: original.content_hash,
      },
    }).then(
      () => false,
      (e: { code: string }) => e.code === 'ATOMIC_REPLACE_UNSUPPORTED',
    )
    assert.equal(unsupported, true)
    assert.equal(
      (await call<{ content: string }>('sftp.readFile', { sessionId: legacySession, path: '/legacy.txt' }))
        .content,
      '原文件必须保留',
    )
    step('safe-save-and-file-operations')
    const upload = await call<{ upload_id: string; tasks: Array<{ id: string }> }>('sftp.uploadBegin', {
      sessionId,
      name: 'upload.txt',
      destDir: dest,
      overwrite: false,
      size: 6,
      lastModified: 10,
    })
    await window.webContents.executeJavaScript(
      `window.eizhu.sftp.uploadChunk({uploadId:${JSON.stringify(upload.upload_id)},sequence:0,data:new TextEncoder().encode('abc')})`,
    )
    await call('sftp.pauseTransfer', { taskId: upload.tasks[0].id })
    const proof = await call<{ prefix_hash: string }>('sftp.uploadCheckpoint', { taskId: upload.tasks[0].id })
    const resumed = await call<{ upload_id: string; received: number; sequence: number }>(
      'sftp.resumeUpload',
      {
        taskId: upload.tasks[0].id,
        size: 6,
        lastModified: 10,
        restart: false,
        prefixHash: proof.prefix_hash,
      },
    )
    assert.equal(resumed.received, 3)
    await window.webContents.executeJavaScript(
      `window.eizhu.sftp.uploadChunk({uploadId:${JSON.stringify(resumed.upload_id)},sequence:1,data:new TextEncoder().encode('def')})`,
    )
    await call('sftp.uploadFinish', { uploadId: resumed.upload_id })
    assert.equal(await readFile(join(remote, 'dest', 'upload.txt'), 'utf8'), 'abcdef')
    const download = await call<{ tasks: Array<{ id: string }> }>('sftp.download', {
      sessionId,
      paths: [source + '/large.bin'],
    })
    await completed(download.tasks[0].id)
    const staged = await runtime.call<{ path: string }>('sftp.downloadPath', { taskId: download.tasks[0].id })
    assert.equal((await readFile(staged.path)).length, 2 * 1024 * 1024 + 17)
    const pulled = await window.webContents.executeJavaScript(
      `(async()=>{let offset=0;while(true){const b=await window.eizhu.sftp.downloadChunk({taskId:${JSON.stringify(download.tasks[0].id)},offset,maxBytes:524288});if(!b.length)break;offset+=b.length}return offset})()`,
    )
    assert.equal(pulled, 2 * 1024 * 1024 + 17)
    const transfer = await call<{ tasks: Array<{ id: string }> }>('sftp.transfer', {
      sourceSessionId: sessionId,
      targetSessionId: localId,
      paths: [source],
      destDir: localPath,
      conflictResolution: 'ask',
      directoryMode: 'preserve',
    })
    await completed(transfer.tasks[0].id)
    assert.equal(await readFile(join(local, 'source', '配置.json'), 'utf8'), '安全保存\r\n')
    const conflict = await call<{ conflicts: unknown[] }>('sftp.transfer', {
      sourceSessionId: sessionId,
      targetSessionId: localId,
      paths: [source],
      destDir: localPath,
      conflictResolution: 'ask',
      directoryMode: 'preserve',
    })
    assert.ok(conflict.conflicts.length >= 2)
    const tar = await call<{ tasks: Array<{ id: string }> }>('sftp.transfer', {
      sourceSessionId: sessionId,
      targetSessionId: localId,
      paths: [source],
      destDir: localPath,
      conflictResolution: 'ask',
      directoryMode: 'archive',
    })
    await completed(tar.tasks[0].id)
    assert.ok(gunzipSync(await readFile(join(local, 'source.tar.gz'))).includes(Buffer.from('安全保存')))
    if (existsSync('/usr/bin/tar'))
      assert.ok(
        (await promisify(execFile)('/usr/bin/tar', ['-tzf', join(local, 'source.tar.gz')])).stdout.includes(
          'source/',
        ),
      )
    const zip = await call<{ tasks: Array<{ id: string }> }>('sftp.download', { sessionId, paths: [source] })
    await completed(zip.tasks[0].id)
    const zipPath = await runtime.call<{ path: string }>('sftp.downloadPath', { taskId: zip.tasks[0].id })
    assert.equal((await readFile(zipPath.path)).readUInt32LE(0), 0x04034b50)
    if (existsSync('/usr/bin/unzip')) await promisify(execFile)('/usr/bin/unzip', ['-t', zipPath.path])
    step('streaming-relay-archives')
    await call('editor.open', { sessionId, sessionType: 'sftp', path: file })
    await wait(async () =>
      windows.editor &&
      (await windows.editor.webContents.executeJavaScript(
        `Boolean(document.querySelector('.monaco-editor textarea'))`,
      ))
        ? true
        : undefined,
    )
    const editor = windows.editor!
    editor.webContents.backgroundThrottling = false
    const forbidden = await editor.webContents.executeJavaScript(
      `window.eizhu.sftp.readFile({sessionId:${JSON.stringify(sessionId)},path:${JSON.stringify(source + '/large.bin')}}).then(()=>false,e=>e.code==='FORBIDDEN')`,
    )
    assert.equal(forbidden, true)
    const monacoAsset = (await readdir(assets)).find((name) => /^monaco-.*\.js$/.test(name))
    assert.ok(monacoAsset)
    await editor.webContents.executeJavaScript(
      `(async()=>{const loaded=await import(${JSON.stringify('eizhu://app/assets/' + monacoAsset)});const loader=Object.values(loaded).find(v=>v&&typeof v.init==='function'&&typeof v.config==='function');const monaco=await loader.init();const model=monaco.editor.getModels().find(m=>!m.isDisposed());model.applyEdits([{range:{startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:1},text:'未保存内容'}]);})()`,
    )
    await wait(async () =>
      (await editor.webContents.executeJavaScript(
        `Boolean([...document.querySelectorAll('.view-line')].find(e=>e.textContent.includes('未保存内容')))`,
      ))
        ? true
        : undefined,
    )
    assert.equal(
      await editor.webContents.executeJavaScript(`Boolean(document.querySelector('.editor-dirty-dot'))`),
      true,
    )
    const confirmation = windows.confirmTransition()
    await wait(async () =>
      (await editor.webContents.executeJavaScript(
        `Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='继续编辑'))`,
      ))
        ? true
        : undefined,
    )
    await editor.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='继续编辑').click()`,
    )
    assert.equal(await confirmation, false)
    await wait(async () =>
      (await editor.webContents.executeJavaScript(`!document.querySelector('[role="alertdialog"]')`))
        ? true
        : undefined,
    )
    await editor.webContents.executeJavaScript(
      `(()=>{window.eizhu.events.on('eizhu-window-close-request',p=>{window.__stage4CloseRequest=p.requestId});return true})()`,
    )
    editor.close()
    await wait(async () =>
      (await editor.webContents.executeJavaScript(
        `Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='继续编辑'))`,
      ))
        ? true
        : undefined,
    )
    await editor.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='继续编辑').click()`,
    )
    await wait(async () =>
      (await editor.webContents.executeJavaScript(`!document.querySelector('[role="alertdialog"]')`))
        ? true
        : undefined,
    )
    assert.equal(
      await editor.webContents.executeJavaScript(
        `window.eizhu.editor.resolveClose({shouldClose:true,requestId:window.__stage4CloseRequest}).then(()=>false,e=>e.code==='REQUEST_EXPIRED')`,
      ),
      true,
    )
    assert.ok(await editor.webContents.executeJavaScript(`document.body.innerText.includes('未保存内容')`))
    await editor.webContents.executeJavaScript(
      `document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`,
    )
    await writeFile(join(root, 'stage4-editor.png'), (await editor.webContents.capturePage()).toPNG())
    windows.closeEditor(true)
    step('editor-ownership-and-dirty-close')
    window.webContents.backgroundThrottling = false
    window.setContentSize(1280, 720)
    await window.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='SFTP 文件').click()`,
    )
    await wait(async () =>
      (await window.webContents.executeJavaScript(`Boolean(document.querySelector('.sftp-pane-empty-btn'))`))
        ? true
        : undefined,
    )
    await window.webContents.executeJavaScript(`document.querySelector('.sftp-pane-empty-btn').click()`)
    await wait(async () =>
      (await window.webContents.executeJavaScript(
        `Boolean([...document.querySelectorAll('.sftp-server-card')].find(e=>e.textContent.includes('阶段 4 合成服务器')))`,
      ))
        ? true
        : undefined,
    )
    await window.webContents.executeJavaScript(
      `[...document.querySelectorAll('.sftp-server-card')].find(e=>e.textContent.includes('阶段 4 合成服务器')).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`,
    )
    await wait(async () =>
      (await window.webContents.executeJavaScript(
        `document.querySelector('.sftp-root')?.textContent.includes('source')&&document.querySelector('.sftp-root')?.textContent.includes('dest')`,
      ))
        ? true
        : undefined,
    )
    await window.webContents.executeJavaScript(
      `document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`,
    )
    await writeFile(join(root, 'stage4-sftp.png'), (await window.webContents.capturePage()).toPNG())
    await window.webContents.executeJavaScript(
      `document.querySelector('button[aria-label="关闭 SFTP"]').click()`,
    )
    await wait(async () =>
      (await window.webContents.executeJavaScript(`!document.querySelector('.sftp-root')`))
        ? true
        : undefined,
    )
    step('sftp-ui-captured')
    const bytes = await readFile(join(root, 'workspaces', 'offline', 'workspace.sqlite'))
    assert.equal(bytes.includes(Buffer.from('upload.txt')), false)
    const removed = await call<{ deleted: number; failed: number }>('sftp.delete', {
      sessionId,
      paths: [dest + '/renamed'],
    })
    assert.equal(removed.deleted, 1)
    assert.equal(removed.failed, 0)
    assert.ok(!(await readdir(join(remote, 'dest'))).some((name) => name.endsWith('.part')))
    const recover = await call<{ upload_id: string; tasks: Array<{ id: string }> }>('sftp.uploadBegin', {
      sessionId: localId,
      name: 'stage4-restored.txt',
      destDir: localPath,
      overwrite: false,
      size: 6,
      lastModified: 42,
    })
    await window.webContents.executeJavaScript(
      `window.eizhu.sftp.uploadChunk({uploadId:${JSON.stringify(recover.upload_id)},sequence:0,data:new TextEncoder().encode('abc')})`,
    )
    return {
      passed: true,
      unavailable: false,
      restoredTaskId: recover.tasks[0].id,
      subsystem: 'OpenSSH sftp-server',
      hostKeyConfirmation: true,
      streaming: true,
      resume: true,
      relay: true,
      tarGz: true,
      zip: true,
      archiveTools: { tar: existsSync('/usr/bin/tar'), unzip: existsSync('/usr/bin/unzip') },
      safeSave: true,
      unsupportedAtomicReplacePreservesOriginal: true,
      editorOwnership: true,
      dirtyCloseCancelled: true,
      staleWindowCloseRejected: true,
      encryptedCheckpoints: true,
    }
  } finally {
    if (windows.editor) windows.closeEditor(true)
    if (sessionId) await call('sftp.closeSession', { id: sessionId }).catch(() => undefined)
    if (localId) await call('sftp.closeSession', { id: localId }).catch(() => undefined)
    if (legacySession) await call('sftp.closeSession', { id: legacySession }).catch(() => undefined)
    if (legacyProfile) await call('profile.delete', { id: legacyProfile }).catch(() => undefined)
    if (profileId) await call('profile.delete', { id: profileId }).catch(() => undefined)
    for (const client of clients) client.end()
    await Promise.all(
      [...children].map(
        (child) =>
          new Promise<void>((resolve) => {
            child.once('close', () => resolve())
            child.kill()
          }),
      ),
    )
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
