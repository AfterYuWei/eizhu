import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SftpService } from './service.ts'
import { displayPath } from './endpoint.ts'
import type { WorkerClient } from '../workers/client.ts'
import type { SshService } from '../ssh/service.ts'
import type { TransferTask, SftpUploadBeginResponse } from '@eizhu/contracts/models/sftp'
import { hash } from './editor.ts'
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-transfer-')),
    saved = new Map<string, unknown>(),
    context = { runtimeId: randomUUID(), workspaceId: 'offline', generation: 1 }
  await mkdir(join(root, 'dest'))
  const db = {
    call: async (op: string, d?: { id: string; value: unknown }) => {
      if (op.endsWith('.list')) return [...saved.values()].map((v) => structuredClone(v))
      if (op.endsWith('.delete')) saved.delete(d!.id)
      else if (op.endsWith('.save')) saved.set(d!.id, structuredClone(d!.value))
    },
  } as unknown as WorkerClient
  const make = () =>
    new SftpService(
      { releaseFiles: () => undefined } as unknown as SshService,
      db,
      context,
      root,
      () => undefined,
      root,
    )
  const service = make()
  const session = (await service.execute('sftp.createSession', { profileId: 'local' })) as {
    session_id: string
  }
  return { root, service, session: session.session_id, make, dest: displayPath(join(root, 'dest')) }
}
const code = (expected: string) => (e: unknown) => (e as { error: { code: string } }).error.code === expected
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
    await assert.rejects(
      x.service.execute('sftp.uploadFinish', { uploadId: b.upload_id }),
      code('TARGET_CHANGED'),
    )
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
  for (let i = 0; i < 200; i++) {
    const t = ((await service.execute('sftp.listTransfers', {})) as TransferTask[]).find((t) => t.id === id)!
    if (['completed', 'failed'].includes(t.status)) return t
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Task timeout')
}
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
  } finally {
    await x.service.close()
    await rm(x.root, { recursive: true, force: true })
  }
})
