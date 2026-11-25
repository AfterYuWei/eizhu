import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildSettings } from '../../scripts/desktop-build-settings.mjs'
const { version, channel, feeds, updateRepository, appId, appName: productName, outputDirectory } = buildSettings()
const local = channel === 'dev'
const macAdHoc = channel === 'test' && process.env.EIZHU_MAC_ADHOC_SIGN === '1'
const macEntitlements = macAdHoc
  ? 'apps/desktop/resources/entitlements.mac.adhoc.plist'
  : 'apps/desktop/resources/entitlements.mac.plist'
export default {
  appId,
  productName,
  executableName: productName,
  directories: { app: 'apps/desktop', output: outputDirectory, buildResources: 'apps/desktop/resources' },
  extraMetadata: {
    name: productName,
    version,
    eizhuChannel: channel,
    main: 'out/main/index.cjs',
    description: 'eizhu 桌面终端与 SFTP 客户端',
    author: 'yuweinfo',
  },
  files: ['out/**', 'resources/**', 'package.json'],
  electronDist: 'node_modules/electron/dist',
  asar: true,
  asarUnpack: ['**/*.node', '**/argon2/**', '**/better-sqlite3/**'],
  npmRebuild: true,
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  async afterPack({ electronPlatformName, appOutDir }) {
    if (electronPlatformName !== 'darwin') return

    // macOS 本地网络隐私使用主程序 UUID；Electron 的预构建启动器由多个应用共用。
    const executable = join(appOutDir, `${productName}.app`, 'Contents', 'MacOS', productName)
    const image = await readFile(executable)
    const headerSize = 32
    if (image.length < headerSize || image.readUInt32LE(0) !== 0xfeedfacf)
      throw new Error('eizhu 启动器必须是单架构的 64 位 Mach-O 文件')

    const commandsEnd = headerSize + image.readUInt32LE(20)
    if (commandsEnd > image.length) throw new Error('eizhu 启动器的 Mach-O 加载命令不完整')
    let uuidOffset
    let hasSignature = false
    for (let offset = headerSize; offset < commandsEnd; ) {
      if (offset + 8 > commandsEnd) throw new Error('eizhu 启动器的 Mach-O 加载命令不完整')
      const command = image.readUInt32LE(offset)
      const size = image.readUInt32LE(offset + 4)
      if (size < 8 || offset + size > commandsEnd)
        throw new Error('eizhu 启动器的 Mach-O 加载命令长度无效')
      if (command === 0x1b && size === 24) uuidOffset = offset + 8 // LC_UUID
      if (command === 0x1d) hasSignature = true // LC_CODE_SIGNATURE
      offset += size
    }
    if (uuidOffset === undefined) throw new Error('eizhu 启动器缺少 Mach-O LC_UUID')

    const uuid = createHash('sha256')
      .update(appId + '\0')
      .update(image.subarray(uuidOffset, uuidOffset + 16))
      .digest()
    uuid[6] = (uuid[6] & 0x0f) | 0x80
    uuid[8] = (uuid[8] & 0x3f) | 0x80
    uuid.copy(image, uuidOffset, 0, 16)
    await writeFile(executable, image)
    // 保持预签名启动器可运行，正式应用签名仍由 electron-builder 处理。
    if (hasSignature)
      execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', appId, executable])
  },
  mac: {
    target: ['dmg', 'zip'],
    icon: 'icon.icns',
    category: 'public.app-category.developer-tools',
    minimumSystemVersion: '13.0',
    extendInfo: {
      NSLocalNetworkUsageDescription: `${productName} 需要访问本地网络，才能通过 SSH 和 SFTP 连接你选择的内网设备。`,
    },
    hardenedRuntime: true,
    entitlements: macEntitlements,
    entitlementsInherit: macEntitlements,
    ...(macAdHoc ? { identity: '-', forceCodeSigning: true, notarize: false } : {}),
  },
  win: { target: ['nsis'], icon: 'icon.ico' },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false },
  linux: {
    target: ['AppImage', 'deb', 'rpm'],
    icon: '256x256.png',
    category: 'Development',
    maintainer: 'yuweinfo',
  },
  protocols: local ? [] : [{ name: 'eizhu', schemes: ['eizhu'] }],
  publish: local
    ? null
    : feeds[channel]
    ? [{ provider: 'generic', url: feeds[channel], channel: 'latest' }]
    : [
        {
          provider: 'github',
          ...updateRepository,
          channel: channel === 'test' ? 'test' : 'latest',
          releaseType: channel === 'test' ? 'prerelease' : 'release',
        },
      ],
}
