import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SensitiveClipboard } from './sensitive-clipboard.ts'
test('main clears an unchanged secret after 30 seconds and preserves later user copies', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let text = ''
  const owner = new SensitiveClipboard({
    readText: () => text,
    writeText: (value) => {
      text = value
    },
  })
  await owner.write('synthetic', 30)
  context.mock.timers.tick(30000)
  await new Promise(setImmediate)
  assert.equal(text, '')
  await owner.write('synthetic', 30)
  text = 'user copy'
  context.mock.timers.tick(30000)
  await new Promise(setImmediate)
  assert.equal(text, 'user copy')
  await owner.write('synthetic', 30)
  await owner.close()
  assert.equal(text, '')
})
