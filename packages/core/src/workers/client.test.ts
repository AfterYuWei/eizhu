import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { WorkerClient } from './client.ts'
const path = fileURLToPath(new URL('./fixture.ts', import.meta.url))
test('worker queue is bounded; closing drains accepted jobs and rejects new work', async () => {
  const client = new WorkerClient(path, undefined, 1)
  const first = client.call('delay', 1),
    second = client.call('echo', 2)
  await assert.rejects(client.call('echo', 3), /任务队列已满/)
  const closing = client.close()
  await assert.rejects(client.call('echo', 4), /不可用/)
  assert.deepEqual(await Promise.all([first, second]), [1, 2])
  await closing
  await client.close()
})
test('worker crash rejects active and queued jobs without replay or orphan promises', async () => {
  const client = new WorkerClient(path, undefined, 4)
  const first = client.call('crash'),
    queued = client.call('echo', 'do not replay')
  const results = await Promise.allSettled([first, queued])
  assert.deepEqual(
    results.map((result) => result.status),
    ['rejected', 'rejected'],
  )
  await assert.rejects(client.call('echo'), /不可用/)
  await client.close()
})

test('queued cancellation frees capacity and removes its abort listener', async () => {
  const client = new WorkerClient(path, undefined, 1),
    controller = new AbortController()
  const first = client.call('delay', 1)
  const queued = client.call('echo', 2, { signal: controller.signal })
  controller.abort()
  await assert.rejects(queued, /任务已取消/)
  assert.equal(EventEmitter.getEventListeners(controller.signal, 'abort').length, 0)
  assert.deepEqual(await Promise.all([first, client.call('echo', 3)]), [1, 3])
  await client.close()
})
test('active cancellation waits for worker completion and leaves the caller buffer owned by the caller', async () => {
  const client = new WorkerClient(path, undefined, 4),
    controller = new AbortController()
  const bytes = Buffer.alloc(8, 7)
  const active = client.call('delay', { bytes }, { signal: controller.signal })
  controller.abort()
  await assert.rejects(active, /任务已取消/)
  assert.deepEqual(bytes, Buffer.alloc(8, 7))
  bytes.fill(0)
  assert.equal(EventEmitter.getEventListeners(controller.signal, 'abort').length, 0)
  assert.equal(await client.call('echo', 'worker available'), 'worker available')
  await client.close()
})
test('unserializable input rejects immediately without poisoning the worker or leaking timers', async () => {
  const client = new WorkerClient(path, undefined)
  await assert.rejects(
    client.call('echo', () => {}),
    /输入无法序列化/,
  )
  assert.equal(await client.call('echo', 'still available'), 'still available')
  await client.close()
})
