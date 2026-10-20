import { build, Platform, Arch } from 'electron-builder'
import config from '../apps/desktop/electron-builder.config.mjs'
import { nativeToolchainEnvironment } from './native-toolchain.mjs'

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
const target = platform === 'darwin' ? Platform.MAC : platform === 'win32' ? Platform.WINDOWS : Platform.LINUX
await build({
  config,
  targets: target.createTarget(
    process.argv.includes('--dir') ? ['dir'] : undefined,
    archName === 'x64' ? Arch.x64 : Arch.arm64,
  ),
  publish: 'never',
})
