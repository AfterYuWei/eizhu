import { mkdtemp, readdir, cp, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'

function run(command, args, cwd) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    const timer = setTimeout(
      () => {
        child.kill()
        reject(new Error('Package operation timeout'))
      },
      // Keep the package supervisor later than smoke-desktop's own deadline so its
      // timeout can terminate the application and report the failure cleanly.
      360_000 + Number(process.argv.findLast((arg) => arg.startsWith('--duration='))?.split('=')[1] ?? 3000),
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
const appName = basename(artifact).startsWith('eizhu-dev-') ? 'eizhu-dev' : 'eizhu'
const developmentFingerprint = process.env.EIZHU_MAC_DEVELOPMENT_CERT_SHA256
async function verifyDevelopmentSignedBundle(bundle, certificatePrefix, appId) {
  assert.match(developmentFingerprint, /^[A-Fa-f0-9]{64}$/, 'Apple Development 证书指纹无效')
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
  const { stderr } = await promisify(execFile)('/usr/bin/codesign', [
    '--display', '--verbose=4', `--extract-certificates=${certificatePrefix}`, bundle,
  ])
  const identifier = /^Identifier=(.+)$/m.exec(stderr)?.[1]
  assert.equal(identifier, appId, 'macOS 安装包的签名应用标识不匹配')
  const signer = await readFile(certificatePrefix + '0')
  const fingerprint = createHash('sha256').update(signer).digest('hex')
  assert.equal(fingerprint, developmentFingerprint.toLowerCase(), 'macOS 安装包的签名证书指纹不匹配')
  const contents = await readdir(join(bundle, 'Contents'), { recursive: true })
  assert.ok(
    !contents.some((entry) => ['embedded.provisionprofile', 'embedded.mobileprovision'].includes(basename(entry))),
    'macOS 安装包包含描述文件',
  )
}

const root = await mkdtemp(join(tmpdir(), 'eizhu-package-'))
let executable
try {
  if (process.platform === 'darwin') {
    const mount = join(root, 'volume')
    await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, artifact])
    try {
      const app = (await readdir(mount)).find((name) => name.endsWith('.app'))
      if (!app) throw new Error('DMG has no application')
      const bundle = join(mount, app)
      if (developmentFingerprint) {
        const { appId } = JSON.parse(await readFile('apps/desktop/out/build-info.json', 'utf8'))
        assert.ok(appId, '构建记录缺少应用标识')
        await verifyDevelopmentSignedBundle(bundle, join(root, 'dmg-signer'), appId)
        const zipRoot = join(root, 'zip')
        await run('/usr/bin/ditto', ['-x', '-k', artifact.replace(/\.dmg$/, '.zip'), zipRoot])
        await verifyDevelopmentSignedBundle(join(zipRoot, app), join(root, 'zip-signer'), appId)
        console.log('macOS DMG 与 ZIP 的签名、证书指纹及描述文件校验通过')
      } else if (process.env.EIZHU_MAC_ADHOC_SIGN === '1') {
        await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
        const { stderr } = await promisify(execFile)('/usr/bin/codesign', ['--display', '--verbose=4', bundle])
        assert.match(stderr, /^Signature=adhoc$/m, 'macOS 测试包应使用临时签名')
        console.log('macOS 安装包临时签名校验通过')
      }
      await cp(bundle, join(root, app), {
        recursive: true,
        verbatimSymlinks: true,
        preserveTimestamps: true,
      })
      executable = join(root, app, 'Contents/MacOS', basename(app, '.app'))
    } finally {
      await run('hdiutil', ['detach', mount])
    }
  } else if (process.platform === 'win32') {
    const install = join(root, 'installed')
    await run(artifact, ['/S', `/D=${install}`])
    executable = join(install, `${appName}.exe`)
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
    const uninstaller = join(root, 'installed', `Uninstall ${appName}.exe`)
    await run(uninstaller, ['/S']).catch(() => undefined)
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
