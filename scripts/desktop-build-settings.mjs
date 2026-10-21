import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

export const updateRepository = { owner: 'AfterYuWei', repo: 'eizhu' }

function sourceDigest() {
  const hash = createHash('sha256')
  const root = new URL('../', import.meta.url)
  const visit = (name) => {
    hash
      .update(name + '\0')
      .update(readFileSync(new URL(name, root)))
      .update('\0')
  }
  const walk = (directory) => {
    for (const entry of readdirSync(new URL(directory, root), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    )) {
      const name = directory + '/' + entry.name
      if (entry.isDirectory()) walk(name)
      else if (entry.isFile()) visit(name)
      else throw new Error(`构建输入不能为符号链接: ${name}`)
    }
  }
  for (const directory of [
    'apps/desktop/src',
    'apps/web/src',
    'apps/web/public',
    'packages/contracts/src',
    'packages/core/src',
  ])
    walk(directory)
  for (const name of [
    'apps/desktop/electron.vite.config.ts',
    'apps/desktop/electron-builder.config.mjs',
    'apps/desktop/package.json',
    'apps/web/package.json',
    'apps/web/index.html',
    'apps/web/smoke.html',
    'package.json',
    'package-lock.json',
    'scripts/build-desktop.mjs',
    'scripts/desktop-build-settings.mjs',
    'scripts/package-desktop.mjs',
    'scripts/rebuild-native.mjs',
    'scripts/patch-ssh2-keygen.mjs',
  ])
    visit(name)
  return hash.digest('hex')
}

export function buildSettings(env = process.env, platform = process.platform, arch = process.arch) {
  const base = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim()
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(base)) throw new Error('VERSION 必须为 x.y.z')
  const channel = env.EIZHU_CHANNEL ?? 'test'
  if (!['stable', 'test'].includes(channel)) throw new Error('EIZHU_CHANNEL 必须为 stable/test')
  if (!['darwin-x64', 'darwin-arm64', 'win32-x64', 'linux-x64'].includes(`${platform}-${arch}`))
    throw new Error('不支持的桌面目标')
  const git = (args) =>
    execFileSync('git', args, { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim()
  const revision = git(['rev-parse', 'HEAD'])
  const version =
    channel === 'stable'
      ? base
      : `${base}-test.${git(['rev-list', '--count', 'HEAD'])}.${revision.slice(0, 8)}`
  const feeds = {}
  for (const selected of ['stable', 'test']) {
    const value = env[`EIZHU_UPDATE_${selected.toUpperCase()}_URL`]
    if (!value) continue
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.hostname.endsWith('.invalid') ||
      !url.pathname.endsWith(`/electron/${selected}/`)
    )
      throw new Error(
        `Electron ${selected} 更新源必须为无凭据的 HTTPS 地址，并以 /electron/${selected}/ 结尾`,
      )
    feeds[selected] = new URL(`${platform}-${arch}/`, url).href
  }
  return {
    base,
    version,
    channel,
    revision,
    platform,
    arch,
    feeds,
    updateRepository,
    sourceDigest: sourceDigest(),
  }
}
