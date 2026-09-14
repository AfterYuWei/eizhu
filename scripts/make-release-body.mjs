#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'

const REPO = 'AfterYuWei/eizhu'
const [, , version, tag, channel, output] = process.argv

if (!version || !tag || !['stable', 'test'].includes(channel) || !output) {
  console.error('用法: node scripts/make-release-body.mjs <version> <tag> <stable|test> <output>')
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`无效的 Release 版本: ${version}`)
  process.exit(1)
}

const expectedTag = channel === 'stable' ? `v${version}` : `test-v${version}`
if (tag !== expectedTag) {
  console.error(`Release 标签与版本不匹配，预期 ${expectedTag}，实际 ${tag}`)
  process.exit(1)
}

const mobileBaseVersion = readFileSync('VERSION_MOBILE', 'utf8').trim()
if (!/^\d+\.\d+\.\d+$/.test(mobileBaseVersion)) {
  console.error(`无效的移动端版本: ${mobileBaseVersion}`)
  process.exit(1)
}

const stable = channel === 'stable'
const testSuffix = stable ? '' : version.match(/-test\.\d+\.[0-9a-f]{7}$/)?.[0]
if (!stable && !testSuffix) {
  console.error(`测试版 Release 版本缺少构建号和短 SHA: ${version}`)
  process.exit(1)
}
const mobileVersion = `${mobileBaseVersion}${testSuffix}`

const releaseUrl = `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tag)}`
const assetUrl = (name) =>
  `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`
const badge = (label, color, logo, asset, alt) =>
  `<a href="${assetUrl(asset)}"><img src="https://img.shields.io/badge/${label}-${color}?logo=${logo}&amp;logoColor=white" alt="${alt}"></a>`

const assets = {
  windows: `eizhu_${version}_x64-setup.exe`,
  macos: `eizhu_${version}_aarch64.dmg`,
  appimage: `eizhu_${version}_amd64.AppImage`,
  deb: `eizhu_${version}_amd64.deb`,
  rpm: `eizhu-${version}-1.x86_64.rpm`,
  android: `eizhu-${mobileVersion}-android-arm64-${stable ? 'release' : 'debug'}.apk`,
  ios: `eizhu-${mobileVersion}-ios-arm64-unsigned.ipa`,
}

const channelTitle = stable ? '✅ 正式版 · Stable' : '🧪 测试版 · Preview'
const channelSummary = stable
  ? '此版本来自 `main` 分支，优先保证稳定性，适合日常使用。'
  : '此版本来自 `dev` 分支，会更早包含新功能和问题修复，适合参与测试。使用前建议备份现有数据。'
const callout = stable
  ? '> [!TIP]\n> 已安装 eizhu 的用户可以在“设置 → 关于”中选择正式版通道并检查更新。'
  : '> [!WARNING]\n> 测试版可能包含尚未发现的问题。遇到异常时，请在 Issues 中附上版本号和复现步骤。'

const body = `# eizhu ${version}

## ${channelTitle}

${channelSummary}

${callout}

## 快速下载

点击对应平台徽标，直接下载本版本的安装包。

<p>
  ${badge('Windows-x64', '0078D4', 'windows11', assets.windows, `下载 Windows x64 eizhu ${version}`)}
  ${badge('macOS-Apple_Silicon', '000000', 'apple', assets.macos, `下载 macOS Apple Silicon eizhu ${version}`)}
  ${badge('Linux-AppImage', 'FCC624', 'linux', assets.appimage, `下载 Linux AppImage eizhu ${version}`)}
  ${badge('Linux-deb', 'A81D33', 'debian', assets.deb, `下载 Linux deb eizhu ${version}`)}
  ${badge('Linux-rpm', '294172', 'fedora', assets.rpm, `下载 Linux rpm eizhu ${version}`)}
  ${badge('Android-arm64', '3DDC84', 'android', assets.android, `下载 Android arm64 eizhu ${mobileVersion}`)}
  ${badge('iOS-arm64_未签名', '000000', 'apple', assets.ios, `下载 iOS arm64 未签名 eizhu ${mobileVersion}`)}
</p>

| 平台 | 架构 | 推荐安装包 | 安装方式 |
| --- | --- | --- | --- |
| Windows | x64 | \`${assets.windows}\` | 双击安装，可直接覆盖旧版本 |
| macOS | Apple Silicon | \`${assets.macos}\` | 打开 DMG，将 eizhu 拖入“应用程序” |
| Debian / Ubuntu | x64 | \`${assets.deb}\` | \`sudo apt install ./eizhu_*_amd64.deb\` |
| Fedora / RHEL | x64 | \`${assets.rpm}\` | \`sudo dnf install ./eizhu-*.x86_64.rpm\` |
| 其他 Linux | x64 | \`${assets.appimage}\` | 添加执行权限后直接运行 |

> [!NOTE]
> macOS 当前仅提供 Apple Silicon 版本。Android 与 iOS 由移动端流水线分别上传；Android APK
> 可直接下载安装，iOS 的 \`unsigned.ipa\` 需要自行签名后侧载。

## 升级与数据兼容

- 从旧版 eizhu 或 Electron 版本升级时，连接配置、凭据和界面设置会自动继承。
- Windows 安装程序支持覆盖安装，无需先卸载。
- Windows、macOS 和 Linux AppImage 支持应用内更新。
- deb、rpm、Android 和 iOS 需要下载新版本后手动更新。
- 正式版与测试版可在“设置 → 关于 → 更新通道”中切换。

## Release 资产说明

- 日常安装只需下载上表中的 \`.exe\`、\`.dmg\`、\`.AppImage\`、\`.deb\` 或 \`.rpm\`。
- \`.sig\` 是应用内更新签名，\`.json\` 是更新通道清单，普通用户无需手动下载。
- \`.app.tar.gz\` 是 macOS 应用内更新包，不是常规安装包。
- 移动端资产文件名使用独立的移动端版本号，因此可能与页面标题中的桌面版本不同。

[查看本版本源代码](https://github.com/${REPO}/tree/${encodeURIComponent(tag)}) ·
[查看全部 Release 资产](${releaseUrl}) ·
[项目主页](https://github.com/${REPO}) ·
[问题反馈](https://github.com/${REPO}/issues)
`

writeFileSync(output, body)
console.log(`[make-release-body] 已生成 ${channel} Release 描述: ${output}`)
