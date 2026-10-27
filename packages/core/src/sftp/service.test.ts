import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SftpService } from './service.ts'
import { FileEndpoint, displayPath, nativePath } from './endpoint.ts'
import type { WorkerClient } from '../workers/client.ts'
import type { SshService } from '../ssh/service.ts'
import type { TransferTask, SftpUploadBeginResponse } from '@eizhu/contracts/models/sftp'
import { hash } from './editor.ts'
import { restoreCheckpoint, type Checkpoint, type CheckpointProgress } from './checkpoint.ts'
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-transfer-')),
    saved = new Map<string, Checkpoint>(),
    progress = new Map<string, CheckpointProgress>(),
    writes: Array<{ operation: string; bytes: number }> = [],
    events: Array<{ type: string; payload: TransferTask }> = [],
    context = { runtimeId: randomUUID(), workspaceId: 'offline', generation: 1 }
  await mkdir(join(root, 'dest'))
  const db = {
    call: async (op: string, d?: { id: string; value: unknown }) => {
      if (op.endsWith('.list')) return [...saved.values()].map((v) => restoreCheckpoint(structuredClone(v), structuredClone(progress.get(v.task.id))))
      if (op.endsWith('.delete')) { saved.delete(d!.id); progress.delete(d!.id) }
      else if (op.endsWith('.save')) {
        saved.set(d!.id, structuredClone(d!.value) as Checkpoint)
        progress.delete(d!.id)
      } else if (op.endsWith('.checkpoint')) progress.set(d!.id, structuredClone(d!.value) as CheckpointProgress)
      if (d?.value) writes.push({ operation: op, bytes: Buffer.byteLength(JSON.stringify(d.value)) })
    },
  } as unknown as WorkerClient
  const make = () =>
    new SftpService(
      { releaseFiles: () => undefined } as unknown as SshService,
      db,
      context,
      root,
      (_name, event) => events.push(structuredClone(event) as (typeof events)[number]),
      root,
    )
  const service = make()
  const session = (await service.execute('sftp.createSession', { profileId: 'local' })) as {
    session_id: string
  }
  return { root, service, session: session.session_id, make, events, writes, dest: displayPath(join(root, 'dest')) }
}
const code = (expected: string) => (e: unknown) => (e as { error: { code: string } }).error.code === expected
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function waitStatus(service: SftpService, id: string, status: TransferTask['status']) {
  for (let i = 0; i < 1000; i++) {
    const task = ((await service.execute('sftp.listTransfers', {})) as TransferTask[]).find((row) => row.id === id)!
    if (task.status === status) return task
    if (task.status === 'failed') throw new Error(task.error_message)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Expected ${status}`)
}

test('后台目录准备立即返回任务，扫描期间取消不创建目标目录', async (t) => {
  const x = await setup(), entered = deferred(), release = deferred()
  const list = FileEndpoint.prototype.listStats
  t.mock.method(FileEndpoint.prototype, 'listStats', async function (this: FileEndpoint, path: string) {
    if (path === displayPath(join(x.root, 'project'))) { entered.resolve(); await release.promise }
    return list.call(this, path)
  })
  try {
    await mkdir(join(x.root, 'project'))
    await writeFile(join(x.root, 'project', 'a'), 'new')
    const created = await x.service.execute('sftp.transfer', {
      sourceSessionId: x.session, targetSessionId: x.session, paths: [displayPath(join(x.root, 'project'))],
      destDir: x.dest, directoryMode: 'preserve', conflictResolution: 'ask', background: true,
    }) as { tasks: TransferTask[] }
    assert.equal(created.tasks.length, 1)
    await entered.promise
    const cancelling = x.service.execute('sftp.cancelTransfer', { taskId: created.tasks[0].id })
    release.resolve()
    assert.equal((await cancelling as TransferTask).status, 'cancelled')
    assert.deepEqual(await readdir(join(x.root, 'dest')), [])
  } finally {
    release.resolve()
    await x.service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})

test('后台冲突持久等待选择，重启后覆盖仅替换同名文件并保留目录其他内容', async () => {
  const x = await setup()
  let service = x.service
  try {
    await mkdir(join(x.root, 'project'))
    await writeFile(join(x.root, 'project', 'a'), 'new')
    await mkdir(join(x.root, 'dest', 'project'))
    await writeFile(join(x.root, 'dest', 'project', 'a'), 'old')
    await writeFile(join(x.root, 'dest', 'project', 'keep'), 'retained')
    const created = await service.execute('sftp.transfer', {
      sourceSessionId: x.session, targetSessionId: x.session, paths: [displayPath(join(x.root, 'project'))],
      destDir: x.dest, directoryMode: 'preserve', conflictResolution: 'ask', background: true,
    }) as { tasks: TransferTask[] }
    const id = created.tasks[0].id
    const paused = await waitStatus(service, id, 'paused')
    assert.equal(paused.conflict_count, 1)
    assert.equal(await readFile(join(x.root, 'dest', 'project', 'a'), 'utf8'), 'old')
    await service.close()
    service = x.make()
    await service.execute('sftp.createSession', { profileId: 'local' })
    const conflicts = await service.execute('sftp.getTransferConflicts', { taskId: id }) as { conflicts: unknown[] }
    assert.equal(conflicts.conflicts.length, 1)
    await service.execute('sftp.resolveTransferConflicts', { taskId: id, resolution: 'overwrite' })
    assert.equal((await terminal(service, id)).status, 'completed')
    assert.equal(await readFile(join(x.root, 'dest', 'project', 'a'), 'utf8'), 'new')
    assert.equal(await readFile(join(x.root, 'dest', 'project', 'keep'), 'utf8'), 'retained')
  } finally {
    await service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})

test('目录重新开始仅重传未完成文件，保留已提交文件及其后续外部修改', async (t) => {
  const x = await setup(), open = FileEndpoint.prototype.open, list = FileEndpoint.prototype.listStats
  let changed = false
  t.mock.method(FileEndpoint.prototype, 'listStats', async function (this: FileEndpoint, path: string) {
    return (await list.call(this, path)).sort((a, b) => a.path.localeCompare(b.path))
  })
  t.mock.method(FileEndpoint.prototype, 'open', async function (this: FileEndpoint, path: string, ...args: [boolean?, boolean?]) {
    if (!changed && path === displayPath(join(x.root, 'project', 'b')) && !args[0]) {
      changed = true
      await writeFile(join(x.root, 'project', 'b'), 'changed-source')
    }
    return open.call(this, path, ...args)
  })
  try {
    await mkdir(join(x.root, 'project'))
    await writeFile(join(x.root, 'project', 'a'), 'first')
    await writeFile(join(x.root, 'project', 'b'), 'old')
    const created = await x.service.execute('sftp.transfer', {
      sourceSessionId: x.session, targetSessionId: x.session, paths: [displayPath(join(x.root, 'project'))],
      destDir: x.dest, directoryMode: 'preserve', conflictResolution: 'ask', background: true,
    }) as { tasks: TransferTask[] }
    const id = created.tasks[0].id
    assert.equal((await terminal(x.service, id)).status, 'failed')
    assert.equal(await readFile(join(x.root, 'dest', 'project', 'a'), 'utf8'), 'first')
    await writeFile(join(x.root, 'dest', 'project', 'a'), 'external-change')
    await x.service.execute('sftp.retryTransfer', { taskId: id, restart: true })
    assert.equal((await terminal(x.service, id)).status, 'completed')
    assert.equal(await readFile(join(x.root, 'dest', 'project', 'a'), 'utf8'), 'external-change')
    assert.equal(await readFile(join(x.root, 'dest', 'project', 'b'), 'utf8'), 'changed-source')
  } finally {
    await x.service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})

test('下载与系统拖出共用后台扫描，目录 ZIP 和原目录树分别保持正确', async () => {
  const x = await setup()
  try {
    await mkdir(join(x.root, 'project', 'empty'), { recursive: true })
    await writeFile(join(x.root, 'project', 'a.txt'), 'directory-bytes')
    const paths = [displayPath(join(x.root, 'project'))]
    const downloaded = await x.service.execute('sftp.download', { sessionId: x.session, paths }) as { tasks: TransferTask[] }
    assert.equal((await terminal(x.service, downloaded.tasks[0].id)).status, 'completed')
    const zip = await x.service.downloadPath(downloaded.tasks[0].id)
    assert.equal(zip.name, 'project.zip')
    const bytes = await readFile(nativePath(zip.path))
    assert.equal(bytes.readUInt32LE(0), 0x04034b50)
    assert.ok(bytes.includes(Buffer.from('directory-bytes')))
    const dragged = await x.service.execute('sftp.prepareDrag', { sessionId: x.session, paths }) as { tasks: TransferTask[] }
    assert.equal((await terminal(x.service, dragged.tasks[0].id)).status, 'completed')
    const directory = await x.service.downloadPath(dragged.tasks[0].id)
    assert.equal(await readFile(join(nativePath(directory.path), 'a.txt'), 'utf8'), 'directory-bytes')
    assert.deepEqual(await readdir(join(nativePath(directory.path), 'empty')), [])
    await x.service.execute('sftp.releaseDrag', { taskIds: [dragged.tasks[0].id] })
  } finally {
    await x.service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})
test('上传按序确认，暂停保留检查点，重启手动恢复并校验原文件', async () => {
  const x = await setup()
  let service = x.service
  try {
    const begin = (await service.execute('sftp.uploadBegin', {
      sessionId: x.session,
      name: 'a',
      destDir: x.dest,
      overwrite: false,
      size: 6,
      lastModified: 1,
    })) as SftpUploadBeginResponse
    await service.execute('sftp.uploadChunk', {
      uploadId: begin.upload_id,
      data: Buffer.from('abc'),
      sequence: 0,
    })
    await assert.rejects(
      service.execute('sftp.uploadChunk', {
        uploadId: begin.upload_id,
        data: Buffer.from('dup'),
        sequence: 0,
      }),
      code('BAD_SEQUENCE'),
    )
    await service.close()
    service = x.make()
    await service.execute('sftp.createSession', { profileId: 'local' })
    const list = (await service.execute('sftp.listTransfers', {})) as TransferTask[]
    assert.equal(list[0].status, 'recoverable')
    await assert.rejects(
      service.execute('sftp.resumeUpload', {
        taskId: list[0].id,
        size: 6,
        lastModified: 1,
        restart: false,
        prefixHash: hash(Buffer.from('xyz')),
      }),
      code('SOURCE_CHANGED'),
    )
    const resumed = (await service.execute('sftp.resumeUpload', {
      taskId: list[0].id,
      size: 6,
      lastModified: 1,
      restart: false,
      prefixHash: hash(Buffer.from('abc')),
    })) as SftpUploadBeginResponse
    assert.equal(resumed.received, 3)
    await service.execute('sftp.uploadChunk', {
      uploadId: resumed.upload_id,
      data: Buffer.from('def'),
      sequence: 1,
    })
    await service.execute('sftp.uploadFinish', { uploadId: resumed.upload_id })
    assert.equal((await terminal(service, list[0].id)).status, 'completed')
    assert.equal(await readFile(join(x.root, 'dest', 'a'), 'utf8'), 'abcdef')
    await assert.rejects(
      service.execute('sftp.uploadChunk', {
        uploadId: begin.upload_id,
        data: Buffer.from('bad'),
        sequence: 1,
      }),
      code('NOT_FOUND'),
    )
  } finally {
    await service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})
test('上传仅在校验与提交后替换目标；目标变化和取消均保留原文件', async () => {
  const x = await setup()
  try {
    await writeFile(join(x.root, 'dest', 'a'), 'original')
    // Distinct whole-second mtimes avoid depending on the filesystem clock's
    // resolution when an external write keeps the same byte length.
    await utimes(join(x.root, 'dest', 'a'), 1_700_000_000, 1_700_000_000)
    const b = (await x.service.execute('sftp.uploadBegin', {
      sessionId: x.session,
      name: 'a',
      destDir: x.dest,
      overwrite: true,
      size: 3,
      lastModified: 1,
    })) as SftpUploadBeginResponse
    await x.service.execute('sftp.uploadChunk', {
      uploadId: b.upload_id,
      data: Buffer.from('new'),
      sequence: 0,
    })
    assert.equal(await readFile(join(x.root, 'dest', 'a'), 'utf8'), 'original')
    await writeFile(join(x.root, 'dest', 'a'), 'external')
    await utimes(join(x.root, 'dest', 'a'), 1_700_000_002, 1_700_000_002)
    await x.service.execute('sftp.uploadFinish', { uploadId: b.upload_id })
    assert.equal((await terminal(x.service, b.tasks[0].id)).error_code, 'TARGET_CHANGED')
    await x.service.execute('sftp.cancelTransfer', { taskId: b.tasks[0].id })
    assert.equal(await readFile(join(x.root, 'dest', 'a'), 'utf8'), 'external')
    assert.deepEqual(await readdir(join(x.root, 'dest')), ['a'])
  } finally {
    await x.service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})
test('五路传输上限与取消释放通道', async () => {
  const x = await setup()
  try {
    const start = (name: string) =>
      x.service.execute('sftp.uploadBegin', {
        sessionId: x.session,
        name,
        destDir: x.dest,
        overwrite: false,
        size: 1,
        lastModified: 1,
      }) as Promise<SftpUploadBeginResponse>
    const tasks = []
    for (let i = 0; i < 5; i++) tasks.push(await start(`f${i}`))
    await assert.rejects(start('six'), code('QUEUE_FULL'))
    await x.service.execute('sftp.cancelTransfer', { taskId: tasks[0].tasks[0].id })
    await start('six')
  } finally {
    await x.service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})
test('并发发起上传仍严格限制五路，篡改暂存文件禁止拼接', async () => {
  const x = await setup()
  try {
    const all = await Promise.allSettled(
      Array.from(
        { length: 12 },
        (_, i) =>
          x.service.execute('sftp.uploadBegin', {
            sessionId: x.session,
            name: `p${i}`,
            destDir: x.dest,
            overwrite: false,
            size: 6,
            lastModified: 1,
          }) as Promise<SftpUploadBeginResponse>,
      ),
    )
    const live = all.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    assert.equal(live.length, 5)
    const first = live[0]
    await x.service.execute('sftp.uploadChunk', {
      uploadId: first.upload_id,
      data: Buffer.from('abc'),
      sequence: 0,
    })
    await x.service.execute('sftp.pauseTransfer', { taskId: first.tasks[0].id })
    const part = (await readdir(join(x.root, 'dest'))).find(
      (name) => name.endsWith('.part') && name.includes('.eizhu-'),
    )!
    const parts = await readdir(join(x.root, 'dest'))
    for (const name of parts)
      if (name.endsWith('.part') && (await readFile(join(x.root, 'dest', name))).length === 3)
        await writeFile(join(x.root, 'dest', name), 'xyz')
    assert.ok(part)
    await assert.rejects(
      x.service.execute('sftp.resumeUpload', {
        taskId: first.tasks[0].id,
        size: 6,
        lastModified: 1,
        restart: false,
        prefixHash: hash(Buffer.from('abc')),
      }),
      code('CHECKPOINT_CHANGED'),
    )
  } finally {
    await x.service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})
async function terminal(service: SftpService, id: string) {
  for (let i = 0; i < 1500; i++) {
    const t = ((await service.execute('sftp.listTransfers', {})) as TransferTask[]).find((t) => t.id === id)!
    if (['completed', 'failed'].includes(t.status)) return t
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Task timeout')
}

test('大量小文件和空目录保持结构，目录计划仅写一次，进度检查点大小不随目录增长', async (t) => {
  const x = await setup()
  try {
    await mkdir(join(x.root, 'project', 'nested', 'empty'), { recursive: true })
    for (let index = 0; index < 160; index++)
      await writeFile(join(x.root, 'project', 'nested', `${index}.txt`), `content:${index}`)
    const copied = await x.service.execute('sftp.transfer', {
      sourceSessionId: x.session, targetSessionId: x.session,
      paths: [displayPath(join(x.root, 'project'))], destDir: x.dest,
      directoryMode: 'preserve', conflictResolution: 'ask',
    }) as { task_id: string; tasks: TransferTask[] }
    assert.equal(copied.task_id, copied.tasks[0].id)
    const result = await terminal(x.service, copied.task_id)
    assert.equal(result.status, 'completed')
    assert.equal(result.items_total, 163)
    assert.equal(result.items_completed, 163)
    assert.equal((await readdir(join(x.root, 'dest', 'project', 'nested', 'empty'))).length, 0)
    for (let index = 0; index < 160; index++)
      assert.equal(await readFile(join(x.root, 'dest', 'project', 'nested', `${index}.txt`), 'utf8'), `content:${index}`)
    const plans = x.writes.filter((write) => write.operation.endsWith('.save'))
    const checkpoints = x.writes.filter((write) => write.operation.endsWith('.checkpoint'))
    assert.equal(plans.length, 1)
    assert.ok(Math.max(...checkpoints.map((write) => write.bytes)) < plans[0].bytes / 10)
    t.diagnostic(`160 个小文件：清单 ${plans[0].bytes} B，仅写一次；最大进度检查点 ${Math.max(...checkpoints.map((write) => write.bytes))} B`)
  } finally {
    await x.service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})

test('目录暂停后重启恢复压缩检查点，不重复提交已完成文件', async (t) => {
  const x = await setup()
  const rename = FileEndpoint.prototype.rename
  const entered = deferred(), release = deferred()
  const commits: string[] = []
  t.mock.method(FileEndpoint.prototype, 'rename', async function (this: FileEndpoint, ...args: Parameters<typeof rename>) {
    if (commits.length === 2) { entered.resolve(); await release.promise }
    await rename.apply(this, args)
    commits.push(args[1])
  })
  let service = x.service
  try {
    await mkdir(join(x.root, 'project'))
    for (let i = 0; i < 8; i++) await writeFile(join(x.root, 'project', `${i}.txt`), `file:${i}`)
    const copied = await service.execute('sftp.transfer', {
      sourceSessionId: x.session, targetSessionId: x.session,
      paths: [displayPath(join(x.root, 'project'))], destDir: x.dest,
      directoryMode: 'preserve', conflictResolution: 'ask',
    }) as { tasks: TransferTask[] }
    await entered.promise
    const pausing = service.execute('sftp.pauseTransfer', { taskId: copied.tasks[0].id })
    release.resolve()
    assert.equal((await pausing as TransferTask).status, 'paused')
    await service.close()
    service = x.make()
    await service.execute('sftp.createSession', { profileId: 'local' })
    const recovered = await service.execute('sftp.listTransfers', {}) as TransferTask[]
    assert.equal(recovered[0].status, 'recoverable')
    await service.execute('sftp.resumeTransfer', { taskId: recovered[0].id })
    assert.equal((await terminal(service, recovered[0].id)).status, 'completed')
    assert.equal(commits.length, 8)
    assert.equal(new Set(commits).size, 8)
    for (let i = 0; i < 8; i++) assert.equal(await readFile(join(x.root, 'dest', 'project', `${i}.txt`), 'utf8'), `file:${i}`)
  } finally {
    release.resolve()
    await service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})
test('重名目录整体重命名，保留原目标并拒绝同一文件系统的自身复制', async () => {
  const x = await setup()
  try {
    await mkdir(join(x.root, 'source'))
    await writeFile(join(x.root, 'source', 'a'), 'new')
    await mkdir(join(x.root, 'dest', 'source'))
    await writeFile(join(x.root, 'dest', 'source', 'a'), 'old')
    const other = (
      (await x.service.execute('sftp.createSession', { profileId: 'local' })) as { session_id: string }
    ).session_id
    const copied = (await x.service.execute('sftp.transfer', {
      sourceSessionId: x.session,
      targetSessionId: other,
      paths: [displayPath(join(x.root, 'source'))],
      destDir: x.dest,
      conflictResolution: 'rename',
      directoryMode: 'preserve',
    })) as { tasks: TransferTask[] }
    assert.equal((await terminal(x.service, copied.tasks[0].id)).status, 'completed')
    assert.equal(await readFile(join(x.root, 'dest', 'source (1)', 'a'), 'utf8'), 'new')
    assert.equal(await readFile(join(x.root, 'dest', 'source', 'a'), 'utf8'), 'old')
    await assert.rejects(
      x.service.execute('sftp.transfer', {
        sourceSessionId: x.session,
        targetSessionId: other,
        paths: [displayPath(join(x.root, 'source'))],
        destDir: displayPath(join(x.root, 'source')),
        conflictResolution: 'overwrite',
        directoryMode: 'preserve',
      }),
      code('BAD_PATH'),
    )
  } finally {
    await x.service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})
test('源文件在排队期间变化，恢复后拒绝提交目标', async () => {
  const x = await setup()
  try {
    const held = []
    for (let i = 0; i < 5; i++)
      held.push(
        (await x.service.execute('sftp.uploadBegin', {
          sessionId: x.session,
          name: `hold${i}`,
          destDir: x.dest,
          overwrite: false,
          size: 1,
          lastModified: 1,
        })) as SftpUploadBeginResponse,
      )
    await writeFile(join(x.root, 'a'), 'before')
    const queued = (await x.service.execute('sftp.transfer', {
      sourceSessionId: x.session,
      targetSessionId: x.session,
      paths: [displayPath(join(x.root, 'a'))],
      destDir: x.dest,
      conflictResolution: 'ask',
      directoryMode: 'preserve',
    })) as { tasks: TransferTask[] }
    const id = queued.tasks[0].id
    await x.service.execute('sftp.pauseTransfer', { taskId: id })
    await writeFile(join(x.root, 'a'), 'after')
    await x.service.execute('sftp.cancelTransfer', { taskId: held[0].tasks[0].id })
    await x.service.execute('sftp.resumeTransfer', { taskId: id })
    assert.equal((await terminal(x.service, id)).error_code, 'SOURCE_CHANGED')
    assert.ok(!(await readdir(join(x.root, 'dest'))).includes('a'))
    await x.service.execute('sftp.retryTransfer', { taskId: id, restart: true })
    const restarted = await terminal(x.service, id)
    assert.equal(restarted.status, 'completed')
    assert.equal(restarted.size, 5)
    assert.equal(restarted.transferred, 5)
    assert.equal(await readFile(join(x.root, 'dest', 'a'), 'utf8'), 'after')
  } finally {
    await x.service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})

const beginUpload = (x: Awaited<ReturnType<typeof setup>>, name: string, size: number) =>
  x.service.execute('sftp.uploadBegin', {
    sessionId: x.session, name, destDir: x.dest, overwrite: false, size, lastModified: 1,
  }) as Promise<SftpUploadBeginResponse>

test('多块上传与复制完成时不再整文件回读，阶段事件强制送达', async (t) => {
  const x = await setup()
  const open = FileEndpoint.prototype.open
  let stageReads = 0
  t.mock.method(FileEndpoint.prototype, 'open', async function (this: FileEndpoint, path: string, ...args: [boolean?, boolean?]) {
    const h = await open.call(this, path, ...args)
    if (path.endsWith('.part') && !args[0]) stageReads++
    return h
  })
  try {
    const block = Buffer.alloc(512 * 1024, 91), size = 8 * 1024 * 1024 + 17
    const begin = await beginUpload(x, 'large.bin', size)
    for (let offset = 0, sequence = 0; offset < size; sequence++) {
      const data = block.subarray(0, Math.min(block.length, size - offset))
      await x.service.execute('sftp.uploadChunk', { uploadId: begin.upload_id, data, sequence })
      offset += data.length
    }
    await x.service.execute('sftp.uploadFinish', { uploadId: begin.upload_id })
    assert.equal((await terminal(x.service, begin.tasks[0].id)).status, 'completed')
    assert.equal(hash(await readFile(join(x.root, 'dest', 'large.bin'))), hash(Buffer.alloc(size, 91)))
    const copied = await x.service.execute('sftp.transfer', {
      sourceSessionId: x.session, targetSessionId: x.session,
      paths: [x.dest + '/large.bin'], destDir: displayPath(x.root),
      conflictResolution: 'ask', directoryMode: 'preserve',
    }) as { tasks: TransferTask[] }
    assert.equal((await terminal(x.service, copied.tasks[0].id)).status, 'completed')
    assert.equal(stageReads, 0)
    const phases = x.events.filter((event) => event.payload.id === begin.tasks[0].id).map((event) => event.payload.phase)
    assert.ok(phases.includes('verifying'))
    assert.ok(phases.includes('committing'))
    assert.equal(x.events.filter((event) => event.type === 'transfer_complete').length, 2)
  } finally {
    await x.service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})

test('完成请求先返回，等 CLOSE 和 rename 确认后才发布已完成；提交胜出的取消不改写结果', async (t) => {
  const x = await setup()
  const rename = FileEndpoint.prototype.rename
  const entered = deferred(), release = deferred()
  t.mock.method(FileEndpoint.prototype, 'rename', async function (this: FileEndpoint, ...args: Parameters<typeof rename>) {
    entered.resolve()
    await release.promise
    return rename.apply(this, args)
  })
  try {
    const begin = await beginUpload(x, 'a', 0)
    const accepted = await x.service.execute('sftp.uploadFinish', { uploadId: begin.upload_id }) as { tasks: TransferTask[] }
    assert.equal(accepted.tasks[0].status, 'transferring')
    await entered.promise
    assert.equal(x.events.some((event) => event.type === 'transfer_complete'), false)
    const stopping = x.service.execute('sftp.cancelTransfer', { taskId: begin.tasks[0].id })
    release.resolve()
    assert.equal((await stopping as TransferTask).status, 'completed')
    assert.equal((await readFile(join(x.root, 'dest', 'a'))).length, 0)
  } finally {
    release.resolve()
    await x.service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})

test('写入与最终提交失败均发布失败并释放五路名额，拒绝旧上传通道', async (t) => {
  const x = await setup()
  const open = FileEndpoint.prototype.open
  t.mock.method(FileEndpoint.prototype, 'open', async function (this: FileEndpoint, path: string, ...args: [boolean?, boolean?]) {
    const h = await open.call(this, path, ...args)
    if (path.endsWith('.part') && args[0]) h.write = async () => {
      throw Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' })
    }
    return h
  })
  try {
    const held = []
    for (let i = 0; i < 5; i++) held.push(await beginUpload(x, `held${i}`, 1))
    await assert.rejects(x.service.execute('sftp.uploadChunk', {
      uploadId: held[0].upload_id, data: Buffer.from('a'), sequence: 0,
    }), /synthetic disk full/)
    assert.equal((await terminal(x.service, held[0].tasks[0].id)).status, 'failed')
    assert.equal((await terminal(x.service, held[0].tasks[0].id)).error_code, 'DISK_FULL')
    await assert.rejects(x.service.execute('sftp.uploadChunk', {
      uploadId: held[0].upload_id, data: Buffer.from('a'), sequence: 0,
    }), code('NOT_FOUND'))
    const last = await beginUpload(x, 'last', 0)
    t.mock.method(FileEndpoint.prototype, 'chmod', async () => { throw new Error('synthetic permission denied') })
    await x.service.execute('sftp.uploadFinish', { uploadId: last.upload_id })
    assert.equal((await terminal(x.service, last.tasks[0].id)).status, 'failed')
    await beginUpload(x, 'replacement', 0)
    assert.equal(x.events.filter((event) => event.type === 'transfer_failed').length, 2)
  } finally {
    await x.service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})

test('提交前取消阻止最终重命名并清理暂存', async (t) => {
  const x = await setup()
  const chmod = FileEndpoint.prototype.chmod
  const entered = deferred(), release = deferred()
  let renames = 0
  t.mock.method(FileEndpoint.prototype, 'chmod', async function (this: FileEndpoint, ...args: Parameters<typeof chmod>) {
    entered.resolve()
    await release.promise
    return chmod.apply(this, args)
  })
  t.mock.method(FileEndpoint.prototype, 'rename', async () => { renames++ })
  try {
    const begin = await beginUpload(x, 'cancelled', 0)
    await x.service.execute('sftp.uploadFinish', { uploadId: begin.upload_id })
    await entered.promise
    const stopping = x.service.execute('sftp.cancelTransfer', { taskId: begin.tasks[0].id })
    release.resolve()
    assert.equal((await stopping as TransferTask).status, 'cancelled')
    assert.equal(renames, 0)
    assert.deepEqual(await readdir(join(x.root, 'dest')), [])
  } finally {
    release.resolve()
    await x.service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})
