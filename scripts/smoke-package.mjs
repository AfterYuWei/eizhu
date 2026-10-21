import { mkdtemp, readdir, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

function run(command, args, cwd) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    const timer = setTimeout(
      () => {
        child.kill()
        reject(new Error('Package operation timeout'))
      },
      180000 + Number(process.argv.findLast((arg) => arg.startsWith('--duration='))?.split('=')[1] ?? 3000),
    )
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) accept()
      else reject(new Error(`${command}: ${code}`))
    })
  })
}
const artifact = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Usage: node scripts/smoke-package.mjs <installer>')
const root = await mkdtemp(join(tmpdir(), 'eizhu-package-'))
let executable
try {
  if (process.platform === 'darwin') {
    const mount = join(root, 'volume')
    await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, artifact])
    try {
      const app = (await readdir(mount)).find((name) => name.endsWith('.app'))
      if (!app) throw new Error('DMG has no application')
      await cp(join(mount, app), join(root, app), {
        recursive: true,
        verbatimSymlinks: true,
        preserveTimestamps: true,
      })
      executable = join(root, app, 'Contents/MacOS/eizhu')
    } finally {
      await run('hdiutil', ['detach', mount])
    }
  } else if (process.platform === 'win32') {
    const install = join(root, 'installed')
    await run(artifact, ['/S', `/D=${install}`])
    executable = join(install, 'eizhu.exe')
  } else {
    if (!artifact.endsWith('.AppImage'))
      throw new Error('Linux foundation smoke currently requires the final AppImage')
    await run('chmod', ['+x', artifact])
    await run(artifact, ['--appimage-extract'], root)
    executable = join(root, 'squashfs-root/AppRun')
  }
  await run(process.execPath, [
    'scripts/smoke-desktop.mjs',
    `--executable=${executable}`,
    ...process.argv.slice(3),
  ])
} finally {
  // Windows installer cleanup remains owned by its uninstaller to release registry/file associations.
  if (process.platform === 'win32') {
    const uninstaller = join(root, 'installed', 'Uninstall eizhu.exe')
    await run(uninstaller, ['/S']).catch(() => undefined)
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
