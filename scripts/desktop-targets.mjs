import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const targets = [
  {
    runner: 'windows-2022',
    platform: 'win32',
    arch: 'x64',
    os: 'win',
    installer: '*.exe',
    extensions: ['exe'],
  },
  {
    runner: 'macos-15-intel',
    platform: 'darwin',
    arch: 'x64',
    os: 'mac',
    installer: '*.dmg',
    extensions: ['dmg', 'zip'],
  },
  {
    runner: 'macos-15',
    platform: 'darwin',
    arch: 'arm64',
    os: 'mac',
    installer: '*.dmg',
    extensions: ['dmg', 'zip'],
  },
  {
    runner: 'ubuntu-22.04',
    platform: 'linux',
    arch: 'x64',
    os: 'linux',
    installer: '*.AppImage',
    extensions: ['AppImage', 'deb', 'rpm'],
  },
]

export function desktopTargets(channel) {
  assert.ok(['stable', 'test'].includes(channel), '发布通道必须为 stable/test')
  return channel === 'stable'
    ? targets
    : targets.filter(
        ({ platform, arch }) => arch === 'x64' && ['win32', 'darwin'].includes(platform),
      )
}

export function desktopBuildMatrix(channel) {
  return {
    include: desktopTargets(channel).map(({ runner, platform, arch, installer }) => ({
      os: runner,
      platform,
      arch,
      installer,
    })),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(desktopBuildMatrix(process.env.RELEASE_CHANNEL ?? 'test')))
