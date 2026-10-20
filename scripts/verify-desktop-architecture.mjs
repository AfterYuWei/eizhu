import assert from 'node:assert/strict'
import { readFile, readdir, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'

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
const manifest = JSON.parse(
  await readFile(join(root, 'tests/fixtures/desktop-baseline/manifest.json'), 'utf8'),
)
const icons = [
  ['icon.icns', 'icon.icns'],
  ['icon.ico', 'icon.ico'],
  ['128x128.png', '128x128.png'],
  ['128x128@2x.png', '256x256.png'],
]
for (const [original, icon] of icons) {
  const bytes = await readFile(join(root, 'apps/desktop/resources', icon))
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  assert.equal(
    blob,
    manifest.sourceFiles.find((source) => source.path === `src-tauri/icons/${original}`).gitBlob,
    `Brand asset changed: ${icon}`,
  )
}
const report = {
  sourceFiles: sources.length,
  oldRuntimeAbsent: true,
  oldMobileEntrypointsAbsent: true,
  rendererNodeImports: 0,
  coreElectronImports: 0,
  lockFiles: 1,
  originalIconsVerified: icons.length,
}
console.log(JSON.stringify(report, null, 2))
