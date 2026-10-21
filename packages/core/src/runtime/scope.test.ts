import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ResourceScope } from './scope.ts'
test('close aborts first, waits all owned resources in reverse order, is idempotent', async () => {
  const scope = new ResourceScope(),
    calls: number[] = []
  scope.own(async () => {
    assert.equal(scope.controller.signal.aborted, true)
    calls.push(1)
  })
  scope.own(() => {
    calls.push(2)
    throw new Error('synthetic cleanup failure')
  })
  scope.own(() => {
    calls.push(3)
  })
  const close = scope.close()
  assert.equal(scope.close(), close)
  await assert.rejects(close, AggregateError)
  assert.deepEqual(calls, [3, 2, 1])
  assert.throws(() => scope.own(() => {}))
})
