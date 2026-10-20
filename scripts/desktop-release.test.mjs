import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareMacosUpdater } from './prepare-macos-updater.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'eizhu-desktop-release-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function run(script, ...args) {
  return spawnSync(process.execPath, [join(root, 'scripts', script), ...args], { cwd: root, encoding: 'utf8' })
}
function signedAsset(dir, name, contents, signature) {
  writeFileSync(join(dir, name), contents)
  writeFileSync(join(dir, `${name}.sig`), signature)
}

for (const channel of ['stable', 'test']) {
  test(`${channel} publishes distinct signed macOS archives and matching updater targets`, (t) => {
    const dir = temporary(t)
    const version = channel === 'stable' ? '0.4.5' : '0.4.5-test.987.1a2b3c4'
    const tag = `${channel === 'stable' ? 'v' : 'test-v'}${version}`
    const assets = join(dir, 'assets')
    mkdirSync(assets)
    for (const arch of ['aarch64', 'x64']) {
      const bundle = join(dir, arch)
      mkdirSync(bundle)
      signedAsset(bundle, 'eizhu.app.tar.gz', `archive-${arch}`, `signature-${arch}`)
      const prepared = run('prepare-macos-updater.mjs', bundle, version, arch)
      assert.equal(prepared.status, 0, prepared.stderr)
      const name = `eizhu_${version}_${arch}.app.tar.gz`
      assert.equal(readFileSync(join(bundle, name), 'utf8'), `archive-${arch}`)
      assert.equal(readFileSync(join(bundle, `${name}.sig`), 'utf8'), `signature-${arch}`)
      assert.equal(prepareMacosUpdater(bundle, version, arch), name)
      for (const file of readdirSync(bundle)) copyFileSync(join(bundle, file), join(assets, file), constants.COPYFILE_EXCL)
    }
    signedAsset(assets, `eizhu_${version}_x64-setup.exe`, 'windows', 'signature-win')
    signedAsset(assets, `eizhu_${version}_amd64.AppImage`, 'linux', 'signature-linux')
    const result = run('make-latest-json.mjs', version, tag, assets, channel)
    assert.equal(result.status, 0, result.stderr)
    const expected = {
      'windows-x86_64': [`eizhu_${version}_x64-setup.exe`, 'signature-win'],
      'darwin-aarch64': [`eizhu_${version}_aarch64.app.tar.gz`, 'signature-aarch64'],
      'darwin-x86_64': [`eizhu_${version}_x64.app.tar.gz`, 'signature-x64'],
      'linux-x86_64': [`eizhu_${version}_amd64.AppImage`, 'signature-linux'],
    }
    for (const [platform, [name, signature]] of Object.entries(expected)) {
      const target = `${channel}-${platform}`
      const manifest = JSON.parse(readFileSync(join(assets, `latest-${target}.json`), 'utf8'))
      assert.equal(manifest.version, version)
      assert.deepEqual(manifest.platforms, {
        [target]: { signature, url: `https://github.com/AfterYuWei/eizhu/releases/download/${tag}/${name}` },
      })
    }
    assert.equal(existsSync(join(assets, 'latest.json')), channel === 'stable')
    if (channel === 'stable') {
      const legacy = JSON.parse(readFileSync(join(assets, 'latest.json'), 'utf8'))
      assert.deepEqual(Object.keys(legacy.platforms).sort(), Object.keys(expected).sort())
    }
    const bodyPath = join(dir, 'release.md')
    const bodyResult = run('make-release-body.mjs', version, tag, channel, bodyPath)
    assert.equal(bodyResult.status, 0, bodyResult.stderr)
    const body = readFileSync(bodyPath, 'utf8')
    assert.ok(body.includes(`eizhu_${version}_x64.dmg`))
    assert.ok(body.includes(`eizhu_${version}_aarch64.dmg`))
    assert.ok(body.includes('| macOS | Intel x64 |'))
    assert.ok(!body.includes('仅提供 Apple Silicon'))
  })
}

test('unsigned builds skip archive preparation; missing signatures and collisions fail without overwriting files', (t) => {
  const dir = temporary(t)
  assert.equal(prepareMacosUpdater(dir, '0.4.5', 'x64'), null)
  writeFileSync(join(dir, 'eizhu.app.tar.gz'), 'archive')
  assert.throws(() => prepareMacosUpdater(dir, '0.4.5', 'x64'), /缺少签名文件/)
  writeFileSync(join(dir, 'eizhu.app.tar.gz.sig'), 'signature')
  writeFileSync(join(dir, 'eizhu_0.4.5_x64.app.tar.gz.sig'), 'keep')
  assert.throws(() => prepareMacosUpdater(dir, '0.4.5', 'x64'), /目标文件已存在/)
  assert.equal(readFileSync(join(dir, 'eizhu.app.tar.gz'), 'utf8'), 'archive')
  assert.equal(readFileSync(join(dir, 'eizhu_0.4.5_x64.app.tar.gz.sig'), 'utf8'), 'keep')
})

test('updater manifests reject ambiguous macOS architectures and unsigned archives', (t) => {
  for (const name of ['eizhu.app.tar.gz', 'eizhu_0.4.5_x64.app.tar.gz']) {
    const dir = temporary(t)
    writeFileSync(join(dir, name), 'archive')
    const result = run('make-latest-json.mjs', '0.4.5', 'v0.4.5', dir, 'stable')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, name === 'eizhu.app.tar.gz' ? /缺少架构标识/ : /缺少签名文件/)
    assert.equal(existsSync(join(dir, 'latest-stable-darwin-x86_64.json')), false)
  }
})
