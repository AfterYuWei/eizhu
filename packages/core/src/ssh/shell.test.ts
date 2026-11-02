/* eslint-disable no-control-regex -- Assertions cover actual terminal control sequences. */
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

test('hides setup echoes redrawn by ZLE while retaining actual shell errors and banners', () => {
  const output = new ShellOutput(), setup = shellSetupCommand('/bin/zsh')!
  output.startBootstrap(setup)
  const echoed = setup.replace('__eizhu_osc7(){', '__ \r\x1b[Ke\reizhu_osc7(){').replace('add-zsh-hook', 'add-zsh-\r\x1b[Khook')
  const packet = Buffer.from(`banner\r\n${echoed}\r\n__eizhu_osc7: permission denied\r\n\x1b]1337;eizhuOsc7Ready\x07prompt$ `)
  const chunks: Buffer[] = []
  for (const byte of packet) chunks.push(output.push(Buffer.from([byte])).data)
  assert.equal(Buffer.concat(chunks).toString(), 'banner\r\n__eizhu_osc7: permission denied\r\nprompt$ ')
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

for (const shell of ['bash', 'zsh']) {
  const available = process.platform !== 'win32' && !spawnSync(shell, ['--version']).error
  test(`${shell} interactive hooks preserve user prompts and identify input/output without installing files`, { skip: !available }, () => {
    const setup = shellSetupCommand(`/bin/${shell}`)!
    const args = shell === 'bash' ? ['--noprofile', '--norc', '-i'] : ['-d', '-f', '-i']
    const result = spawnSync('/bin/sh', ['-c', 'exec "$@" 2>&1', 'eizhu-shell-test', shell, ...args], {
      input: [
        "PS1='TEST> '; PS2='MORE> '",
        shell === 'bash' ? "PROMPT_COMMAND='printf USER_HOOK; '" : "precmd(){ printf USER_HOOK; }",
        setup,
        setup,
        'false',
        'printf "LAST_STATUS=%s\\n" "$?"',
        "printf 'PAYLOAD\\n'",
        'exit',
      ].join('\n') + '\n',
      timeout: 10000,
      env: { ...process.env, TERM: 'xterm-256color' },
    })
    assert.equal(result.status, 0, result.stdout.toString())
    const output = result.stdout.toString()
    assert.ok(!output.includes('syntax error'), output)
    assert.ok(output.includes('USER_HOOK'))
    assert.ok(output.includes('TEST> '))
    if (shell === 'bash') {
      const version = spawnSync(shell, ['-c', 'printf "%s.%s" "${BASH_VERSINFO[0]}" "${BASH_VERSINFO[1]}"']).stdout.toString().split('.').map(Number)
      if (version[0] < 4 || version[0] === 4 && version[1] < 4) {
        assert.ok(!output.includes('\x1b]133;B\x07'))
        assert.ok(output.includes('\x1b]7;file://'))
        return
      }
    }
    assert.match(output, /\x1b\]133;A\x07TEST> \x1b\]133;B\x07/)
    assert.match(output, /\x1b\]133;C\x07PAYLOAD/)
    // Reinstalling the hook must not nest prompt wrappers or change command status.
    assert.ok(!output.includes('\x1b]133;A\x07\x1b]133;A\x07'))
    assert.match(output, /LAST_STATUS=1\r?\n/)
  })
}

for (const promptCommand of [
  '',
  'printf USER_HOOK',
  'printf USER_HOOK;',
  'printf USER_HOOK; ',
  'history -a; ',
  'printf USER_HOOK # user comment',
  'printf USER_HOOK &',
  'printf USER_HOOK\n',
  'printf USER_HOOK;__eizhu_osc7',
]) {
  test(`Bash preserves and executes scalar PROMPT_COMMAND ${JSON.stringify(promptCommand)}`, { skip: process.platform === 'win32' }, () => {
    const setup = shellSetupCommand('/bin/bash')!
    const result = spawnSync('bash', ['--noprofile', '--norc', '-c', [
      'PROMPT_COMMAND=$1',
      setup,
      setup,
      // Run the prompt in a function so its hook can preserve the last command status.
      'render_prompt(){ eval "$PROMPT_COMMAND"; }',
      'false; render_prompt; status=$?',
      'wait',
      'printf "\\nLAST_STATUS=%s\\n" "$status"',
      'printf "PROMPT_COMMAND=%s" "$PROMPT_COMMAND"',
    ].join('\n'), 'eizhu-shell-test', promptCommand], { timeout: 5000 })
    assert.equal(result.status, 0, result.stderr.toString())
    assert.equal(result.stderr.toString(), '')
    const output = result.stdout.toString()
    const command = output.slice(output.indexOf('PROMPT_COMMAND=') + 'PROMPT_COMMAND='.length)
    assert.ok(command.startsWith(promptCommand))
    assert.equal(command.match(/__eizhu_osc7/g)?.length, 1)
    assert.equal(output.match(/\x1b\]7;file:\/\//g)?.length, 3)
    if (promptCommand.includes('USER_HOOK')) assert.ok(output.includes('USER_HOOK'))
    // Without a user hook, our hook must preserve the previous command's failure.
    if (!promptCommand) assert.match(output, /LAST_STATUS=1\n/)
  })
}

test('Bash PROMPT_COMMAND arrays remain arrays with their existing elements and one directory hook', { skip: process.platform === 'win32' }, () => {
  const setup = shellSetupCommand('/bin/bash')!
  const result = spawnSync('bash', ['-c', `PROMPT_COMMAND=('printf first' 'printf second');${setup};${setup};declare -p PROMPT_COMMAND`], { timeout: 5000 })
  assert.equal(result.status, 0, result.stderr.toString())
  const declaration = result.stdout.toString().split('\x07').at(-1)!
  assert.match(declaration, /declare -a PROMPT_COMMAND/)
  assert.ok(declaration.includes('printf first'))
  assert.ok(declaration.includes('printf second'))
  assert.equal(declaration.match(/__eizhu_osc7/g)?.length, 1)
})
