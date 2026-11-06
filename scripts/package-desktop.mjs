import { build, Platform, Arch } from 'electron-builder'
import config from '../apps/desktop/electron-builder.config.mjs'
import { nativeToolchainEnvironment } from './native-toolchain.mjs'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { buildSettings } from './desktop-build-settings.mjs'
import { patchInstalledSsh2 } from './patch-ssh2-keygen.mjs'

await patchInstalledSsh2()

const platform =
  process.argv.find((value) => value.startsWith('--platform='))?.split('=')[1] ?? process.platform
const archName = process.argv.find((value) => value.startsWith('--arch='))?.split('=')[1] ?? process.arch
if (
  !['darwin', 'win32', 'linux'].includes(platform) ||
  !['x64', 'arm64'].includes(archName) ||
  (archName === 'arm64' && platform !== 'darwin')
)
  throw new Error('Unsupported desktop target')
if (platform !== process.platform || archName !== process.arch)
  throw new Error('请在对应平台和架构的 CI/主机打包，不能复用本机 Electron 分发与原生模块')
Object.assign(process.env, nativeToolchainEnvironment())
assert.deepEqual(
  JSON.parse(await readFile('apps/desktop/out/build-info.json', 'utf8')),
  buildSettings(),
  '构建版本、通道、更新源或提交与打包环境不一致，请重新 desktop:build',
)
const target = platform === 'darwin' ? Platform.MAC : platform === 'win32' ? Platform.WINDOWS : Platform.LINUX
await build({
  config,
  targets: target.createTarget(
    process.argv.includes('--dir') ? ['dir'] : undefined,
    archName === 'x64' ? Arch.x64 : Arch.arm64,
  ),
  publish: 'never',
})
