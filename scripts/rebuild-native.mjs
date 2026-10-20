import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../package.json', import.meta.url))
let cpuDirectory
try {
  const sshRequire = createRequire(require.resolve('ssh2/package.json'))
  cpuDirectory = dirname(sshRequire.resolve('cpu-features/package.json'))
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error
}
// electron-rebuild invokes node-gyp directly. cpu-features needs its own generated include first.
if (cpuDirectory) {
  const result = await promisify(execFile)(process.execPath, ['buildcheck.js'], { cwd: cpuDirectory })
  await writeFile(join(cpuDirectory, 'buildcheck.gypi'), result.stdout)
}
await new Promise((accept, reject) => {
  const child = spawn(process.execPath, [require.resolve('electron-builder/cli.js'), 'install-app-deps'], {
    cwd: root,
    stdio: 'inherit',
  })
  child.on('error', reject)
  child.on('exit', (code) => {
    if (code === 0) accept()
    else reject(new Error(`Native rebuild failed (${code})`))
  })
})
