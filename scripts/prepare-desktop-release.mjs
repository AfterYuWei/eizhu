import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSettings } from './desktop-build-settings.mjs'

const targets = [
  { platform: 'win32', arch: 'x64', os: 'win', extensions: ['exe'] },
  { platform: 'darwin', arch: 'x64', os: 'mac', extensions: ['dmg', 'zip'] },
  { platform: 'darwin', arch: 'arm64', os: 'mac', extensions: ['dmg', 'zip'] },
  { platform: 'linux', arch: 'x64', os: 'linux', extensions: ['AppImage', 'deb', 'rpm'] },
]

export function validatePackagedRun(run, jobs, repository) {
  assert.equal(run.repository?.full_name, repository, '产物必须来自当前仓库')
  assert.equal(run.path, '.github/workflows/build-desktop-stable.yml')
  assert.equal(run.head_branch, 'main')
  assert.equal(run.status, 'completed')
  assert.match(run.head_sha, /^[a-f0-9]{40}$/)
  const packages = jobs.filter((job) => job.name.startsWith('desktop / package ('))
  const expected = [
    'desktop / package (windows-2022, win32, x64, *.exe)',
    'desktop / package (macos-15-intel, darwin, x64, *.dmg)',
    'desktop / package (macos-15, darwin, arm64, *.dmg)',
    'desktop / package (ubuntu-22.04, linux, x64, *.AppImage)',
  ]
  assert.deepEqual(packages.map((job) => job.name).sort(), expected.sort(), '必须包含完整四目标')
  for (const job of packages) assert.equal(job.conclusion, 'success', `目标未通过: ${job.name}`)
  return run.head_sha
}

export async function prepareDesktopRelease({
  version,
  revision,
  inputDirectory,
  outputDirectory,
  expectedSourceDigest,
}) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  assert.match(revision, /^[a-f0-9]{40}$/)
  const assets = []
  const digests = new Set()
  for (const { platform, arch, os, extensions } of targets) {
    const target = `${platform}-${arch}`
    const directory = join(inputDirectory, `eizhu-stable-${target}`)
    const infoPath = join(directory, 'smoke', `build-info-${target}.json`)
    const smokePath = join(directory, 'smoke', `${target}.json`)
    const info = JSON.parse(await readFile(infoPath, 'utf8'))
    const smoke = JSON.parse(await readFile(smokePath, 'utf8'))
    assert.deepEqual(
      [info.version, info.channel, info.revision, info.platform, info.arch],
      [version, 'stable', revision, platform, arch],
      `构建来源不匹配: ${target}`,
    )
    assert.match(info.sourceDigest, /^[a-f0-9]{64}$/)
    digests.add(info.sourceDigest)
    assert.deepEqual([smoke.platform, smoke.arch, smoke.packaged], [platform, arch, true])
    for (const stage of ['stage2', 'stage3', 'stage5', 'stage6'])
      assert.equal(smoke[stage]?.passed, true, `${target}: ${stage} 烟测未通过`)
    assert.ok(smoke.stage4?.passed || smoke.stage4?.unavailable, `${target}: 阶段 4 烟测失败`)
    assert.equal(smoke.stage3.load?.passed, true)
    assert.ok(smoke.stage3.load.elapsedMs >= 60000, `${target}: 60 秒负载未完成`)
    const files = await readdir(join(directory, 'desktop'))
    const installerNames = []
    for (const extension of extensions) {
      const fileArch = platform === 'linux' ? (extension === 'deb' ? 'amd64' : 'x86_64') : arch
      const name = `eizhu-${version}-${os}-${fileArch}.${extension}`
      assert.ok(files.includes(name), `缺少安装资产: ${name}`)
      installerNames.push(name)
      assets.push({ name, path: join(directory, 'desktop', name) })
    }
    for (const name of files.filter((name) =>
      installerNames.some((installer) => name === installer + '.blockmap'),
    ))
      assets.push({ name, path: join(directory, 'desktop', name) })
    assets.push(
      { name: `build-info-${target}.json`, path: infoPath },
      { name: `smoke-${target}.json`, path: smokePath },
    )
  }
  assert.equal(digests.size, 1, '四目标源码指纹不一致')
  if (expectedSourceDigest)
    assert.equal([...digests][0], expectedSourceDigest, '产物与当前应用源码指纹不一致')
  assert.equal(new Set(assets.map(({ name }) => name)).size, assets.length, '发布资产名称冲突')
  await mkdir(outputDirectory, { recursive: true })
  assert.equal((await readdir(outputDirectory)).length, 0, '发布输出目录必须为空')
  const sums = []
  for (const { name, path } of assets.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const destination = join(outputDirectory, name)
    await copyFile(path, destination)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(destination)) hash.update(chunk)
    sums.push(`${hash.digest('hex')}  ${name}`)
  }
  await writeFile(join(outputDirectory, 'SHA256SUMS.txt'), sums.join('\n') + '\n')
  return assets.map(({ name }) => name)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const assets = await prepareDesktopRelease({
    version: process.env.RELEASE_VERSION,
    revision: process.env.RELEASE_SOURCE_SHA ?? process.env.GITHUB_SHA,
    expectedSourceDigest: buildSettings({ EIZHU_CHANNEL: 'stable' }).sourceDigest,
    inputDirectory: 'release-input',
    outputDirectory: 'release-output',
  })
  console.log(`四目标来源及烟测验证通过，共 ${assets.length} 个资产与 SHA256SUMS.txt`)
}
