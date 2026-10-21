import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { stopProcess, type ExitingProcess } from './process-shutdown.ts'

class FakeProcess extends EventEmitter implements ExitingProcess {
  readonly sent: unknown[] = []
  killCalls = 0
  readonly pid: number | undefined
  private readonly killResult: boolean
  private readonly postMessageError: Error | undefined

  constructor(
    pid: number | undefined,
    killResult = true,
    postMessageError?: Error,
  ) {
    super()
    this.pid = pid
    this.killResult = killResult
    this.postMessageError = postMessageError
  }

  postMessage(message: unknown): void {
    if (this.postMessageError) throw this.postMessageError
    this.sent.push(message)
  }

  kill(): boolean {
    this.killCalls += 1
    return this.killResult
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

test('shutdown message leaves stop pending until the real exit event and then removes its listener', async () => {
  const child = new FakeProcess(42)
  let settled = false
  const stopped = stopProcess(child, { graceful: 1000, forced: 1000 }).then(() => {
    settled = true
  })

  assert.deepEqual(child.sent, [{ type: 'shutdown' }])
  assert.equal(child.listenerCount('exit'), 1)
  await delay(0)
  assert.equal(settled, false)

  child.emit('exit', 0)
  await stopped
  assert.equal(settled, true)
  assert.equal(child.listenerCount('exit'), 0)
  assert.equal(child.killCalls, 0)
})

test('graceful deadline kills the child but still waits for its exit event', async () => {
  const child = new FakeProcess(42)
  let settled = false
  const stopped = stopProcess(child, { graceful: 5, forced: 1000 }).then(() => {
    settled = true
  })

  await delay(20)
  assert.equal(child.killCalls, 1)
  assert.equal(settled, false)
  assert.equal(child.listenerCount('exit'), 1)

  child.emit('exit', null)
  await stopped
  assert.equal(settled, true)
  assert.equal(child.listenerCount('exit'), 0)
})

test('failed kill rejects and removes the exit listener', async () => {
  const child = new FakeProcess(42, false)
  await assert.rejects(stopProcess(child, { graceful: 5, forced: 1000 }), (error: { error?: { code?: string } }) => {
    assert.equal(error.error?.code, 'RUNTIME_STOP_FAILED')
    return true
  })

  assert.equal(child.killCalls, 1)
  assert.equal(child.listenerCount('exit'), 0)
})

test('successful forced kill still rejects at its deadline if no exit arrives and cleans up', async () => {
  const child = new FakeProcess(42)
  await assert.rejects(stopProcess(child, { graceful: 5, forced: 5 }), (error: { error?: { code?: string } }) => {
    assert.equal(error.error?.code, 'RUNTIME_STOP_FAILED')
    return true
  })

  assert.equal(child.killCalls, 1)
  assert.equal(child.listenerCount('exit'), 0)
})

test('postMessage failure switches directly to force kill and still waits for exit', async () => {
  const child = new FakeProcess(42, true, new Error('closed channel'))
  let settled = false
  const stopped = stopProcess(child, { graceful: 1000, forced: 1000 }).then(() => {
    settled = true
  })

  assert.equal(child.killCalls, 1)
  assert.equal(settled, false)
  assert.equal(child.listenerCount('exit'), 1)
  child.emit('exit', 0)
  await stopped
  assert.equal(settled, true)
  assert.equal(child.listenerCount('exit'), 0)
})

test('missing pid is a no-op', async () => {
  const child = new FakeProcess(undefined)
  await stopProcess(child)

  assert.deepEqual(child.sent, [])
  assert.equal(child.killCalls, 0)
  assert.equal(child.listenerCount('exit'), 0)
})
