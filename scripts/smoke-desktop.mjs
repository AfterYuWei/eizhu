import { mkdtemp, readFile, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import electron from 'electron'
import assert from 'node:assert/strict'

const executableArg = process.argv.find((value) => value.startsWith('--executable='))?.slice(13)
const executable = executableArg ? resolve(executableArg) : electron
const container = await mkdtemp(join(tmpdir(), 'eizhu-desktop-smoke-'))
const root = join(container, 'profile')
const args = [...(executableArg ? [] : ['.']), '--smoke-test', `--smoke-root=${container}`]
const duration = Number(process.argv.findLast((arg) => arg.startsWith('--duration='))?.split('=')[1] ?? 3000)
assert.ok(
  Number.isSafeInteger(duration) && duration >= 1000 && duration <= 8 * 60 * 60 * 1000,
  'duration must be 1000..28800000 ms',
)
args.push(`--load-duration=${duration}`)
// Linux CI needs a real X server (xvfb-run); it never disables Chromium sandboxing here.
await new Promise((accept, reject) => {
  const child = spawn(executable, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      EIZHU_SMOKE_FIXTURES: resolve('tests/fixtures/desktop-baseline'),
    },
  })
  const timer = setTimeout(() => {
    child.kill()
    reject(new Error('Smoke timeout'))
  }, 180_000 + duration)
  child.on('error', (error) => {
    clearTimeout(timer)
    reject(error)
  })
  child.on('exit', (code) => {
    clearTimeout(timer)
    if (code === 0) accept()
    else reject(new Error(`Smoke exit ${code}`))
  })
})
const report = JSON.parse(await readFile(join(root, 'smoke.json'), 'utf8'))
assert.equal(report.renderer.node, 'undefined')
assert.equal(report.renderer.require, 'undefined')
assert.equal(report.renderer.bridge, 'function')
assert.equal(report.health.workers, 2)
assert.equal(report.crypto.kdf, true)
assert.equal(report.crypto.crypto, true)
assert.equal(report.crypto.ssh2, true)
assert.equal(report.updaterModule, true)
assert.equal(report.recovery.persistedSettings, true)
assert.equal(report.monaco.typescript, true)
assert.equal(report.monaco.json, true)
assert.equal(report.editor, true)
assert.equal(report.stage2.passed, true)
assert.equal(report.accountFoundation.passed, true)
assert.equal(report.accountClosure.passed, true)
assert.equal(report.syncEngine.passed, true)
assert.equal(report.syncDesktop.passed, true)
assert.equal(report.stage3.passed, true)
assert.equal(report.stage3.completionUi.passed, true)
assert.equal(report.stage3.completionMatrix.generators, 10)
assert.equal(report.stage3.load.passed, true)
if (report.stage4.unavailable) console.warn('阶段 4 协议集成待验：本机缺少 OpenSSH sftp-server')
else assert.equal(report.stage4.passed, true)
assert.equal(report.stage5.passed, true)
assert.equal(report.stage6.passed, true)
assert.equal(report.workspaceTabs.passed, true)
if (executableArg) assert.equal(report.packaged, true)
const evidenceRoot = `artifacts/smoke/${process.platform}-${process.arch}`
await mkdir(evidenceRoot, { recursive: true })
// Keep visual evidence outside the temporary profile so CI and later reviews can retrieve it.
for (const name of ['home-light.png', 'home-dark.png', 'editor-empty.png', ...report.workspaceTabs.screenshots, ...report.accountClosure.screenshots, ...report.syncDesktop.screenshots, ...report.stage3.completionUi.screenshots]) {
  assert.ok(report.screenshots.includes(name), `Missing screenshot: ${name}`)
  await copyFile(join(root, name), join(evidenceRoot, name))
}
if (report.stage5.passed)
  await copyFile(join(root, 'stage5-backup.png'), join(evidenceRoot, 'stage5-backup.png'))
await copyFile(join(root, 'stage6-update.png'), join(evidenceRoot, 'stage6-update.png'))
if (report.stage4.passed)
  for (const name of ['stage4-editor.png', 'stage4-sftp.png', ...report.stage4.editorLayout.screenshots])
    await copyFile(join(root, name), join(evidenceRoot, name))
await writeFile(
  `artifacts/smoke/${process.platform}-${process.arch}.json`,
  JSON.stringify(report, null, 2) + '\n',
)
console.log(
  `烟测通过：${process.platform}/${process.arch}；证据 artifacts/smoke/${process.platform}-${process.arch}.json`,
)
