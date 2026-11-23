import { mkdtemp, readFile, mkdir, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import electron from 'electron'

// Uses a fresh profile and a loopback SSH peer backed by the installed OpenSSH
// subsystem. Does not connect to user servers or load user credentials/data.
const executableArg = process.argv.find((arg) => arg.startsWith('--executable='))?.slice(13)
const executable = executableArg ? resolve(executableArg) : electron
const root = await mkdtemp(join(tmpdir(), 'eizhu-sftp-smoke-'))
try {
  await new Promise((accept, reject) => {
    const child = spawn(executable, [
      ...(executableArg ? [] : ['.']), '--smoke-test', '--sftp-smoke', `--smoke-root=${root}`,
    ], { stdio: 'inherit' })
    const timer = setTimeout(() => { child.kill(); reject(new Error('SFTP smoke timeout')) }, 180_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) accept()
      else reject(new Error(`SFTP smoke exit ${code}, signal ${signal}`))
    })
  })
  const reportPath = join(root, 'profile', 'sftp-smoke.json')
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  assert.equal(report.stage4.passed, true)
  assert.equal(report.stage4.reconnect.passed, true)
  assert.equal(report.stage4.largeUpload.sha256, true)
  assert.equal(report.stage4.largeTransfers.length, 2)
  assert.ok(report.stage4.largeTransfers.every((transfer) => transfer.sha256))
  if (executableArg) assert.equal(report.packaged, true)
  const evidence = `artifacts/sftp-smoke/${process.platform}-${process.arch}`
  await mkdir(evidence, { recursive: true })
  await copyFile(reportPath, join(evidence, 'report.json'))
  for (const name of ['stage4-sftp.png', 'stage4-editor.png', ...report.stage4.editorLayout.screenshots, ...report.stage4.reconnect.screenshots])
    await copyFile(join(root, 'profile', name), join(evidence, name))
  console.log(`SFTP 验收通过：${evidence}/report.json`)
} finally {
  await rm(root, { recursive: true, force: true })
}
