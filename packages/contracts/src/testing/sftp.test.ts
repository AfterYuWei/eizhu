import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sftp, sftpEventSchema } from '../sftp.ts'
test('文件 IPC 拒绝越界分块、NUL、遍历文件名及伪造事件', () => {
  assert.equal(
    sftp['sftp.uploadChunk'].input.safeParse({
      uploadId: 'x',
      sequence: 0,
      data: new Uint8Array(512 * 1024 + 1),
    }).success,
    false,
  )
  assert.equal(
    sftp['sftp.uploadBegin'].input.safeParse({
      sessionId: 'x',
      name: '../a',
      destDir: '/',
      overwrite: false,
      size: 1,
      lastModified: 1,
    }).success,
    false,
  )
  assert.equal(sftp['sftp.stat'].input.safeParse({ sessionId: 'x', path: '/a\0b' }).success, false)
  assert.equal(
    sftpEventSchema.safeParse({
      type: 'transfer_progress',
      workspaceGeneration: 1,
      payload: { task_id: 'x' },
    }).success,
    false,
  )
  assert.equal(
    sftp['sftp.downloadChunk'].input.safeParse({ taskId: 'x', offset: -1, maxBytes: 10 }).success,
    false,
  )
})
