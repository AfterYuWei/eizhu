import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { nativeToolchainEnvironment } from './native-toolchain.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../package.json', import.meta.url))
const environment = nativeToolchainEnvironment()
async function runNode(script, args = []) {
  await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      stdio: 'inherit',
      env: environment,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) accept()
      else reject(new Error(`Native setup failed (${code}): ${script}`))
    })
  })
}
// Electron 44 ships an explicit installer rather than a dependency postinstall hook.
// Ensure its checksum-verified distribution exists before building or starting the desktop app.
await runNode(require.resolve('electron/install.js'))
let cpuDirectory
try {
  const sshRequire = createRequire(require.resolve('ssh2/package.json'))
  cpuDirectory = dirname(sshRequire.resolve('cpu-features/package.json'))
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error
}
// electron-rebuild invokes node-gyp directly. cpu-features needs its own generated include first.
if (cpuDirectory) {
  const result = await promisify(execFile)(process.execPath, ['buildcheck.js'], {
    cwd: cpuDirectory,
    env: environment,
  })
  await writeFile(join(cpuDirectory, 'buildcheck.gypi'), result.stdout)
}
await runNode(require.resolve('electron-builder/cli.js'), ['install-app-deps'])
