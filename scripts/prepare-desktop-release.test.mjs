import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareDesktopRelease } from './prepare-desktop-release.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-release-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const options = {
    version: '0.5.0',
    revision: 'a'.repeat(40),
    inputDirectory: join(root, 'input'),
    outputDirectory: join(root, 'output'),
  }
  for (const [platform, arch, os, extensions] of [
    ['win32', 'x64', 'win', ['exe']],
    ['darwin', 'x64', 'mac', ['dmg', 'zip']],
    ['darwin', 'arm64', 'mac', ['dmg', 'zip']],
    ['linux', 'x64', 'linux', ['AppImage', 'deb', 'rpm']],
  ]) {
    const directory = join(options.inputDirectory, `eizhu-stable-${platform}-${arch}`)
    await mkdir(join(directory, 'desktop'), { recursive: true })
    await mkdir(join(directory, 'smoke'), { recursive: true })
    for (const extension of extensions)
      await writeFile(
        join(directory, 'desktop', `eizhu-0.5.0-${os}-${arch}.${extension}`),
        `asset ${platform} ${arch} ${extension}`,
      )
    await writeFile(
      join(directory, 'smoke', `build-info-${platform}-${arch}.json`),
      JSON.stringify({
        version: options.version,
        channel: 'stable',
        revision: options.revision,
        platform,
        arch,
        sourceDigest: 'b'.repeat(64),
      }),
    )
    await writeFile(
      join(directory, 'smoke', `${platform}-${arch}.json`),
      JSON.stringify({
        platform,
        arch,
        packaged: true,
        stage2: { passed: true },
        stage3: { passed: true, load: { passed: true, elapsedMs: 60001 } },
        stage4: { unavailable: true },
        stage5: { passed: true },
        stage6: { passed: true },
      }),
    )
  }
  return options
}

test('release requires all four targets and hashes the exact copied installer bytes', async (t) => {
  const options = await fixture(t)
  const assets = await prepareDesktopRelease(options)
  assert.equal(assets.length, 16)
  const sums = await readFile(join(options.outputDirectory, 'SHA256SUMS.txt'), 'utf8')
  for (const line of sums.trim().split('\n')) {
    const [hash, name] = line.split('  ')
    assert.equal(
      createHash('sha256')
        .update(await readFile(join(options.outputDirectory, name)))
        .digest('hex'),
      hash,
    )
  }
  await assert.rejects(prepareDesktopRelease(options), /输出目录必须为空/)
})

test('release rejects a missing target or installer', async (t) => {
  const options = await fixture(t)
  const installer = join(
    options.inputDirectory,
    'eizhu-stable-linux-x64',
    'desktop',
    'eizhu-0.5.0-linux-x64.rpm',
  )
  await rm(installer)
  await assert.rejects(prepareDesktopRelease(options), /缺少安装资产/)
  await rm(join(options.inputDirectory, 'eizhu-stable-linux-x64'), { recursive: true })
  await assert.rejects(prepareDesktopRelease(options), { code: 'ENOENT' })
})

test('release rejects mismatched provenance, failed smoke and incomplete load', async (t) => {
  const options = await fixture(t)
  await assert.rejects(prepareDesktopRelease({ ...options, revision: 'c'.repeat(40) }), /构建来源不匹配/)
  const directory = join(options.inputDirectory, 'eizhu-stable-linux-x64', 'smoke')
  const infoPath = join(directory, 'build-info-linux-x64.json')
  const info = JSON.parse(await readFile(infoPath, 'utf8'))
  await writeFile(infoPath, JSON.stringify({ ...info, sourceDigest: 'c'.repeat(64) }))
  await assert.rejects(prepareDesktopRelease(options), /源码指纹不一致/)
  await writeFile(infoPath, JSON.stringify(info))
  const smokePath = join(directory, 'linux-x64.json')
  const smoke = JSON.parse(await readFile(smokePath, 'utf8'))
  await writeFile(smokePath, JSON.stringify({ ...smoke, stage6: { passed: false } }))
  await assert.rejects(prepareDesktopRelease(options), /stage6 烟测未通过/)
  smoke.stage3.load.elapsedMs = 3000
  await writeFile(smokePath, JSON.stringify(smoke))
  await assert.rejects(prepareDesktopRelease(options), /60 秒负载未完成/)
})
