import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkpointProgress, restoreCheckpoint, type Checkpoint } from './checkpoint.ts'

test('目录进度仅保存当前游标，恢复保留已提交文件、偏移及哈希，兼容旧记录', () => {
  const file = { source: '/s', dest: '/d', temporary: '/part', dir: false, complete: false, offset: 0,
    stat: { size: 20, mtime: 1, mode: 0o100600, dir: false, link: false, identity: 'source' } }
  const base: Checkpoint = { task: { id: 'id', file_name: 'project', direction: 'transfer', size: 60,
    transferred: 0, speed: 0, started_at: 1, status: 'queued' }, files: [file, file, file].map((f) => ({ ...f })),
    index: 0, sourceProfile: 'local', targetProfile: 'local', sourceSession: 's', targetSession: 't' }
  const running = structuredClone(base)
  running.index = 1
  running.files[0].complete = true
  Object.assign(running.files[1], { offset: 7, prefixHash: 'confirmed' })
  running.task.transferred = 27
  const progress = checkpointProgress(running)
  assert.equal('files' in progress, false)
  assert.equal(JSON.stringify(progress).includes('/part'), false)
  const restored = restoreCheckpoint(base, progress)
  assert.equal(restored.files[0].complete, true)
  assert.equal(restored.files[0].offset, 20)
  assert.equal(restored.files[1].offset, 7)
  assert.equal(restored.files[1].prefixHash, 'confirmed')
  assert.equal(restored.files[2].complete, false)
  assert.equal(restored.task.transferred, 27)
  assert.equal(base.files[0].complete, false)
  assert.equal(restoreCheckpoint(base), base)
})
