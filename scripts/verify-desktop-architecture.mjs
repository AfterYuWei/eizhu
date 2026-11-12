import assert from 'node:assert/strict'
import { readFile, readdir, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative, sep } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
async function files(directory) {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map((entry) => {
        const path = join(directory, entry.name)
        return entry.isDirectory() ? files(path) : [path]
      }),
    )
  ).flat()
}
for (const name of ['src-tauri', 'web', 'VERSION_MOBILE']) {
  await assert.rejects(access(join(root, name)), { code: 'ENOENT' })
}
const sources = (
  await Promise.all(
    ['apps/web/src', 'apps/desktop/src', 'packages/core/src', 'packages/contracts/src'].map((path) =>
      files(join(root, path)),
    ),
  )
).flat()
for (const path of sources) {
  const name = relative(root, path).split(sep).join('/')
  assert.ok(!/\.(rs|swift)$/.test(name), `Old owned runtime: ${name}`)
  assert.ok(!/(^|\/)(?:mobile|Mobile|useMobile)[^/]*(?:\/|\.)/.test(name), `Mobile source: ${name}`)
  if (!/\.tsx?$/.test(path) || path.includes('.test.')) continue
  const text = await readFile(path, 'utf8')
  assert.ok(!/@tauri-apps|tauri-plugin|__TAURI|isMobileRuntime/.test(text), `Old bridge: ${name}`)
  if (name.startsWith('apps/web/src/'))
    assert.ok(
      !/from\s+['"](?:electron|node:|@eizhu\/core|better-sqlite3|ssh2)/.test(text),
      `Node capability in renderer: ${name}`,
    )
  if (name.startsWith('packages/core/'))
    assert.ok(!/from\s+['"]electron['"]/.test(text), `Electron dependency in core: ${name}`)
}
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
assert.ok(
  !Object.keys(lock.packages).some((path) => /tauri|crabnebula/.test(path)),
  'Old container dependency in lock',
)
for (const name of ['apps/web/package-lock.json', 'apps/desktop/package-lock.json'])
  await assert.rejects(access(join(root, name)), { code: 'ENOENT' })
// Historical brand assets remain frozen in the baseline; current platform
// resources share one vector and must agree with each other.
const resources = join(root, 'apps/desktop/resources')
const pngs = new Map()
for (const [name, size] of [
  ['128x128.png', 128],
  ['256x256.png', 256],
  ['brand.png', 1024],
]) {
  const bytes = await readFile(join(resources, name))
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `Invalid PNG: ${name}`)
  assert.equal(bytes.readUInt32BE(16), size, `PNG width: ${name}`)
  assert.equal(bytes.readUInt32BE(20), size, `PNG height: ${name}`)
  assert.equal(bytes[25], 6, `PNG must retain alpha: ${name}`)
  pngs.set(size, bytes)
}
const ico = await readFile(join(resources, 'icon.ico'))
assert.equal(ico.readUInt16LE(0), 0)
assert.equal(ico.readUInt16LE(2), 1)
const icoSizes = []
for (let index = 0; index < ico.readUInt16LE(4); index++) {
  const entry = 6 + index * 16
  const size = ico[entry] || 256
  assert.equal(ico[entry + 1] || 256, size, 'ICO must be square')
  const offset = ico.readUInt32LE(entry + 12)
  const length = ico.readUInt32LE(entry + 8)
  assert.ok(offset >= 6 + ico.readUInt16LE(4) * 16 && offset + length <= ico.length)
  const png = ico.subarray(offset, offset + length)
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(png.readUInt32BE(16), size)
  assert.equal(png.readUInt32BE(20), size)
  if (pngs.has(size)) assert.deepEqual(png, pngs.get(size), `ICO PNG differs: ${size}`)
  icoSizes.push(size)
}
assert.deepEqual(icoSizes, [16, 24, 32, 48, 64, 128, 256])
const icns = await readFile(join(resources, 'icon.icns'))
assert.equal(icns.toString('ascii', 0, 4), 'icns')
assert.equal(icns.readUInt32BE(4), icns.length)
const icnsChunks = new Map()
for (let offset = 8; offset < icns.length;) {
  const length = icns.readUInt32BE(offset + 4)
  assert.ok(length > 8 && offset + length <= icns.length, 'Invalid ICNS chunk')
  icnsChunks.set(icns.toString('ascii', offset, offset + 4), icns.subarray(offset + 8, offset + length))
  offset += length
}
for (const [type, size] of [
  ['ic07', 128],
  ['ic08', 256],
  ['ic10', 1024],
])
  assert.deepEqual(icnsChunks.get(type), pngs.get(size), `ICNS PNG differs: ${type}`)
const logo = await readFile(join(root, 'apps/web/public/eizhu-logo.svg'), 'utf8')
const mark = logo.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)?.[1].trim()
assert.ok(mark, 'Missing brand vector')
for (const name of ['apps/web/public/favicon.svg', 'apps/desktop/resources/icon.svg'])
  assert.ok((await readFile(join(root, name), 'utf8')).includes(mark), `Brand mark differs: ${name}`)
const report = {
  sourceFiles: sources.length,
  oldRuntimeAbsent: true,
  oldMobileEntrypointsAbsent: true,
  rendererNodeImports: 0,
  coreElectronImports: 0,
  lockFiles: 1,
  brandResourcesVerified: 8,
  windowsIconSizes: icoSizes,
  macIconVariants: icnsChunks.size,
}
const activeEntryFiles = [
  'package.json',
  'Makefile',
  '.github/CI.md',
  ...(await files(join(root, '.github/workflows'))).map((path) => relative(root, path)),
]
for (const name of activeEntryFiles) {
  const content = await readFile(join(root, name), 'utf8')
  assert.ok(
    !/VERSION_MOBILE|run-tauri|cargo (?:test|build|check)|tauri (?:build|dev|android|ios)|TAURI_SIGNING_PRIVATE_KEY/.test(
      content,
    ),
    `Retired build/release entry: ${name}`,
  )
}
report.activeBuildAndCiFiles = activeEntryFiles.length
report.retiredBuildEntrypoints = 0
console.log(JSON.stringify(report, null, 2))
