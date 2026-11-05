import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import electron from 'electron'
import assert from 'node:assert/strict'
const container = await mkdtemp(join(tmpdir(), 'eizhu-ai-smoke-'))
console.log('AI_SMOKE_ROOT', container)
const child = spawn(electron, ['.', '--smoke-test', '--ai-smoke-only', '--smoke-root=' + container], {
  stdio: 'inherit',
  env: { ...process.env, EIZHU_SMOKE: '1' },
})
await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('AI smoke failed: ' + code))))
})
const report = JSON.parse(await readFile(join(container, 'profile', 'ai-smoke.json'), 'utf8'))
assert.equal(report.aiDesktop.passed, true)
console.log(JSON.stringify(report, null, 2))
