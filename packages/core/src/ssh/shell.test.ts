import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShellOutput, shellSetupCommand } from './shell.ts'

test('detects supported login shells without sending syntax to unknown shells', () => {
  for (const name of ['bash', 'zsh', 'fish']) {
    assert.ok(shellSetupCommand(`login banner\n/usr/local/bin/${name}\n`)?.includes('__eizhu_osc7'))
  }
  assert.equal(shellSetupCommand('/bin/sh\n'), undefined)
  assert.equal(shellSetupCommand(''), undefined)
})

test('hides fragmented and repeated setup echoes, preserves banner bytes and reports the new cwd', () => {
  const output = new ShellOutput(),
    setup = shellSetupCommand('/bin/bash')!
  output.startBootstrap(setup)
  const packet = Buffer.from(
    `欢迎 🧪\r\n${setup}\r\nuser@host$ ${setup}\r\n\x1b]7;file:///srv/项目%20files\x07\x1b]1337;eizhuOsc7Ready\x07user@host$ `,
  )
  const chunks: Buffer[] = []
  const paths: string[] = []
  let ready = 0
  for (const byte of packet) {
    const result = output.push(Buffer.from([byte]))
    chunks.push(result.data)
    if (result.cwd) paths.push(result.cwd)
    if (result.ready) ready++
  }
  assert.equal(Buffer.concat(chunks).toString(), '欢迎 🧪\r\n\x1b]7;file:///srv/项目%20files\x07user@host$ ')
  assert.deepEqual(paths, ['/srv/项目 files'])
  assert.equal(ready, 1)
  const next = output.push(Buffer.from('\x1b]7;file:///tmp/one\x07\x1b]7;file://host/tmp/two\x1b\\'))
  assert.equal(next.cwd, '/tmp/two')
  assert.equal(output.push(Buffer.from('ordinary output')).cwd, undefined)
})

test('bootstrap fallback releases pending output and bounds retained data', () => {
  const output = new ShellOutput()
  output.startBootstrap(shellSetupCommand('/bin/bash')!)
  assert.equal(output.push(Buffer.from('slow prompt$ ')).data.length, 0)
  assert.equal(output.finishBootstrap().toString(), 'slow prompt$ ')
  assert.equal(output.push(Buffer.from('input echo')).data.toString(), 'input echo')
  output.startBootstrap(shellSetupCommand('/bin/bash')!)
  const large = output.push(Buffer.alloc(65537, 65))
  assert.equal(large.ready, true)
  assert.equal(large.data.length, 65537)
})

for (const shell of ['bash', 'zsh', 'fish']) {
  const available = process.platform !== 'win32' && !spawnSync(shell, ['--version'], { timeout: 2000 }).error
  test(`${shell} hook reports cd changes in an actual local shell`, { skip: !available }, () => {
    const root = mkdtempSync(join(tmpdir(), 'eizhu-shell-'))
    try {
      mkdirSync(join(root, '项目 files'))
      const setup = shellSetupCommand(`/bin/${shell}`)!
      const prompt =
        shell === 'bash' ? 'eval "$PROMPT_COMMAND"' : shell === 'zsh' ? '__eizhu_osc7' : 'emit fish_prompt'
      const result = spawnSync(shell, ['-c', `${setup};cd '项目 files';${prompt}`], {
        cwd: root,
        timeout: 5000,
      })
      assert.equal(result.status, 0, result.stderr.toString())
      const output = new ShellOutput()
      assert.equal(output.push(result.stdout).cwd, realpathSync(join(root, '项目 files')))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
