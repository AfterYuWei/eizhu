import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareDesktopRelease, validatePackagedRun } from './prepare-desktop-release.mjs'
import { parseUpdateInfo } from 'electron-updater/out/providers/Provider.js'

async function fixture(t, channel = 'stable') {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-release-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const options = {
    version: channel === 'stable' ? '0.5.0' : '0.5.0-test.100.aaaaaaaa',
    channel,
    revision: 'a'.repeat(40),
    expectedSourceDigest: 'b'.repeat(64),
    inputDirectory: join(root, 'input'),
    outputDirectory: join(root, 'output'),
  }
  for (const [platform, arch, os, extensions] of [
    ['win32', 'x64', 'win', ['exe']],
    ['darwin', 'x64', 'mac', ['dmg', 'zip']],
    ['darwin', 'arm64', 'mac', ['dmg', 'zip']],
    ['linux', 'x64', 'linux', ['AppImage', 'deb', 'rpm']],
  ]) {
    const directory = join(options.inputDirectory, `eizhu-${channel}-${platform}-${arch}`)
    await mkdir(join(directory, 'desktop'), { recursive: true })
    await mkdir(join(directory, 'smoke'), { recursive: true })
    for (const extension of extensions) {
      const fileArch = platform === 'linux' ? (extension === 'deb' ? 'amd64' : 'x86_64') : arch
      await writeFile(
        join(directory, 'desktop', `eizhu-${options.version}-${os}-${fileArch}.${extension}`),
        `asset ${platform} ${arch} ${extension}`,
      )
    }
    await writeFile(
      join(directory, 'smoke', `build-info-${platform}-${arch}.json`),
      JSON.stringify({
        version: options.version,
        channel,
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
  assert.equal(assets.length, 19)
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

for (const channel of ['stable', 'test']) {
  test(`${channel}: updater parses platform manifests with exact installer SHA-512 and both macOS architectures`, async (t) => {
    const options = await fixture(t, channel)
    await prepareDesktopRelease({ ...options, releaseNotes: '中文更新说明\n第二行' })
    const prefix = channel === 'test' ? 'test' : 'latest'
    for (const [suffix, extension, count] of [
      ['', '.exe', 1],
      ['-mac', '.zip', 4],
      ['-linux', '.AppImage', 1],
    ]) {
      const name = `${prefix}${suffix}.yml`
      const info = parseUpdateInfo(await readFile(join(options.outputDirectory, name), 'utf8'), name, name)
      assert.equal(info.version, options.version)
      assert.equal(info.releaseNotes, '中文更新说明\n第二行')
      assert.equal(info.files.length, count)
      assert.ok(info.files.some((file) => file.url.endsWith(extension)))
      if (suffix === '-mac') {
        for (const arch of ['x64', 'arm64'])
          assert.ok(info.files.some((file) => file.url.endsWith(`-${arch}.zip`)))
      }
      for (const file of info.files) {
        const bytes = await readFile(join(options.outputDirectory, file.url))
        assert.equal(file.size, bytes.length)
        assert.equal(file.sha512, createHash('sha512').update(bytes).digest('base64'))
      }
    }
    await assert.rejects(
      prepareDesktopRelease({ ...options, channel: channel === 'test' ? 'stable' : 'test' }),
    )
  })
}

test('release rejects a missing target or installer', async (t) => {
  const options = await fixture(t)
  const installer = join(
    options.inputDirectory,
    'eizhu-stable-linux-x64',
    'desktop',
    'eizhu-0.5.0-linux-x86_64.rpm',
  )
  await rm(installer)
  await assert.rejects(prepareDesktopRelease(options), /缺少安装资产/)
  await rm(join(options.inputDirectory, 'eizhu-stable-linux-x64'), { recursive: true })
  await assert.rejects(prepareDesktopRelease(options), { code: 'ENOENT' })
})

test('release rejects mismatched provenance, failed smoke and incomplete load', async (t) => {
  const options = await fixture(t)
  await assert.rejects(
    prepareDesktopRelease({ ...options, expectedSourceDigest: 'c'.repeat(64) }),
    /当前应用源码指纹不一致/,
  )
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

test('publication retry requires this repository, main, the stable workflow and four successful package jobs', () => {
  const run = {
    repository: { full_name: 'owner/repo' },
    path: '.github/workflows/build-desktop-stable.yml',
    head_branch: 'main',
    status: 'completed',
    head_sha: 'a'.repeat(40),
  }
  const jobs = [
    'desktop / package (windows-2022, win32, x64, *.exe)',
    'desktop / package (macos-15-intel, darwin, x64, *.dmg)',
    'desktop / package (macos-15, darwin, arm64, *.dmg)',
    'desktop / package (ubuntu-22.04, linux, x64, *.AppImage)',
  ].map((name) => ({ name, conclusion: 'success' }))
  assert.equal(validatePackagedRun(run, jobs, 'owner/repo'), run.head_sha)
  assert.throws(() => validatePackagedRun(run, jobs, 'other/repo'))
  assert.throws(() => validatePackagedRun({ ...run, head_branch: 'dev' }, jobs, 'owner/repo'))
  assert.throws(() =>
    validatePackagedRun({ ...run, path: '.github/workflows/other.yml' }, jobs, 'owner/repo'),
  )
  assert.throws(() => validatePackagedRun(run, jobs.slice(1), 'owner/repo'))
  assert.throws(() =>
    validatePackagedRun(
      run,
      jobs.map((job, i) => (i ? job : { ...job, conclusion: 'failure' })),
      'owner/repo',
    ),
  )
})
