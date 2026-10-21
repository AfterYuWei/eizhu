# 阶段 5 证据索引

2026-10-21，macOS x64；本轮没有使用真实账号/云存储或真实用户数据。其他目标平台与真实厂商 OAuth 均待验，官方账号同步按用户指示延后。

| 证据 | 内容 |
|---|---|
| [check.log](check.log) / [lint.log](lint.log) | 类型及 lint 通过 |
| [test.log](test.log) | 55 基础/核心 + 205 前端 + 10 固定基线 = 270 通过 |
| [baseline.log](baseline.log) / [architecture.log](architecture.log) | 固定兼容样本只读及架构边界 |
| [build.log](build.log) / [package.log](package.log) | 最终构建和未签名 DMG/ZIP 打包 |
| [构建烟测 JSON](mac-x64-build-smoke.json) / [原始日志](mac-x64-build-smoke.log) | 完整 Electron 进程树、原生 SQLite/KDF、合成 WebDAV/S3 与旧阶段回归 |
| [安装产物烟测 JSON](mac-x64-package-smoke.json) / [原始日志](mac-x64-package-smoke.log) | 从最终 DMG 提取应用后的同套完整烟测 |
| [实际包内文件](mac-x64-package-files.json) | DMG 提取应用内 267 个 out 文件与构建逐字节一致 |
| [构建备份页](mac-x64-build-backup.png) / [安装产物备份页](mac-x64-package-backup.png) | 实际 React 设置页，目标及业务数据均为合成内容；不包含目标密码 |
| [交付清单](delivery.json) | 基线、版本、检查状态、源码、证据和测试安装包 SHA-256 |

`stage5.passed` 仅代表 JSON 列出的已执行合成场景，不代表 Google/Microsoft 真实账号、其他平台、官方服务、签名/公证或长稳验收。日志中的 Electron 图标/退出系统调度警告未导致测试失败，不计为原生窗口和 OS 交互验收。
