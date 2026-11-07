import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiSmokeShell } from './ai-smoke-shell.ts'
import { shellSetupCommand } from '@eizhu/core/ssh/shell'

test('AI smoke peer acknowledges shell setup at every SSH input split', () => {
  const input = Buffer.from(shellSetupCommand('/bin/bash')! + '\n')
  for (let split = 1; split < input.length; split++) {
    const output: string[] = []
    const consume = createAiSmokeShell(
      (data) => output.push(data),
      [],
      () => false,
    )
    consume(input.subarray(0, split))
    consume(input.subarray(split))
    assert.ok(output.join('').includes('\x1b]1337;eizhuOsc7Ready\x07'), `split ${split}`)
  }
})

test('AI smoke peer buffers split UTF-8 and handles multiple commands in one chunk', () => {
  const output: string[] = [],
    commands: string[] = []
  const consume = createAiSmokeShell(
    (data) => output.push(data),
    commands,
    () => false,
  )
  const first = "printf 'eizhuAi;first;start 你好 🧪'"
  for (const byte of Buffer.from(first + '\r')) consume(Buffer.from([byte]))
  consume(Buffer.from("printf 'eizhuAi;second;start'\r\nprintf 'eizhuAi;third;start'\n"))
  assert.equal(commands.length, 3)
  assert.ok(commands[0].includes('你好 🧪'))
  for (const token of ['first', 'second', 'third'])
    assert.ok(output.join('').includes(`\x1b]1337;eizhuAi;${token};end;3\x07`))
})

test('AI smoke peer cancels partial input and bounds its input buffer', () => {
  const commands: string[] = [],
    output: string[] = []
  const consume = createAiSmokeShell(
    (data) => output.push(data),
    commands,
    () => true,
  )
  consume(Buffer.from("printf 'eizhuAi;cancelled;start'"))
  consume(Buffer.from('\x03'))
  assert.equal(commands.length, 0)
  assert.ok(output.join('').includes('\x1b]1337;eizhuPrompt\x07'))
  assert.throws(() => consume(Buffer.alloc(262145, 65)), /input.*limit/)
})
