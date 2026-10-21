import assert from 'node:assert/strict'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { extractFile, listPackage } from '@electron/asar'
import { buildSettings } from './desktop-build-settings.mjs'

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const directory = resolve(option('directory') ?? 'artifacts/desktop')
const archive = option('asar')
const settings = buildSettings()
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const describe = async (path) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return { path: relative(process.cwd(), path), bytes: (await stat(path)).size, sha256: hash.digest('hex') }
}
assert.deepEqual(JSON.parse(await readFile('apps/desktop/out/build-info.json', 'utf8')), settings)
const names = (await readdir(directory)).filter(
  (name) =>
    name.startsWith(`eizhu-${settings.version}-`) &&
    /\.(?:dmg|zip|exe|AppImage|deb|rpm|blockmap)$/.test(name),
)
assert.ok(names.length > 0, '没有匹配当前版本的交付产物')
const artifacts = await Promise.all(names.sort().map((name) => describe(join(directory, name))))
let packageFiles = []
if (archive) {
  const metadata = JSON.parse(extractFile(archive, 'package.json').toString('utf8'))
  assert.equal(metadata.version, settings.version, '安装包版本不一致')
  assert.equal(metadata.eizhuChannel, settings.channel, '安装包通道不一致')
  const entries = listPackage(archive).filter((name) => name.startsWith('/out/') && !name.endsWith('/'))
  for (const entry of entries) {
    const file = join('apps/desktop', entry.slice(1))
    const info = await stat(file)
    if (info.isDirectory()) continue
    const built = await readFile(file),
      packaged = extractFile(archive, entry.slice(1))
    assert.deepEqual(packaged, built, `安装包与当前构建输出不同: ${entry}`)
    packageFiles.push({ path: entry.slice(1), bytes: built.length, sha256: sha256(built) })
  }
  assert.ok(packageFiles.length > 100, '安装包输出清单不完整')
  const builtFiles = []
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else builtFiles.push(relative('apps/desktop', path).replaceAll('\\', '/'))
    }
  }
  await walk('apps/desktop/out')
  assert.deepEqual(packageFiles.map((file) => file.path).sort(), builtFiles.sort(), '安装包遗漏构建输出')
}
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const sourceNames = git([
  'ls-files',
  '-z',
  '--cached',
  '--others',
  '--exclude-standard',
  '--',
  'apps',
  'packages',
  'scripts',
  'docs',
  '.github',
  'package.json',
  'package-lock.json',
  'AGENTS.md',
  'README.md',
  'DESIGN.md',
  'VERSION',
  'Makefile',
  '.gitattributes',
  '.gitignore',
  'eslint.config.mjs',
  'tsconfig.node.json',
]).split('\0')
const deleted = new Set(git(['ls-files', '-z', '--deleted']).split('\0'))
const sources = await Promise.all(
  [...new Set(sourceNames)]
    .filter((name) => name && !name.includes('/evidence/') && !deleted.has(name))
    .sort()
    .map(describe),
)
const report = {
  generatedAt: new Date().toISOString(),
  baseCommit: settings.revision,
  branch: git(['branch', '--show-current']),
  settings,
  dirtyWorkspace: Boolean(git(['status', '--porcelain', '--untracked-files=no'])),
  artifacts,
  packageFiles,
  sources,
  publication: 'local-test-candidate-only',
  acceptance: 'See docs/desktop-rebuild/STAGE_6_REPORT.md; unexecuted release gates remain pending',
}
if (option('report')) await writeFile(option('report'), JSON.stringify(report, null, 2) + '\n')
console.log(
  JSON.stringify(
    { artifacts, verifiedPackageFiles: packageFiles.length, sourceFiles: sources.length },
    null,
    2,
  ),
)
