# 阶段 6 证据索引

2026-10-21，macOS x64；所有 Electron smoke 使用全新临时数据/Chromium/缓存目录，服务和密钥均为合成数据。官方账号同步延期，真实账号、签名、其他目标与 8 小时验收不计为通过。

- `check.log`、`lint.log`、`test.log`：最终类型、lint 和完整回归。
- `baseline.log`、`architecture.log`：只读固定格式/历史 Git 源与品牌、进程边界及现役构建/CI 审计。
- `build.log`、`package.log`：本机最终构建及未签名 DMG/ZIP 打包。
- `build-guard.log`：test 构建在 stable 环境打包被前置拒绝。
- `mac-x64-build-update.png`：最终构建输出的“关于”更新失败反馈截图。
- `build-smoke.log`、`mac-x64-build-smoke.json`：最终构建输出全进程树 smoke，含 3 秒合成负载。
- `package-smoke.log`、`mac-x64-package-smoke.json`：最终 DMG 内容全进程树 smoke，含 60 秒合成负载。
- `mac-x64-package-home-light.png`、`mac-x64-package-home-dark.png`、`mac-x64-package-editor.png`、`mac-x64-package-sftp.png`、`mac-x64-package-backup.png`、`mac-x64-package-update.png`：最终包的实际窗口截图；更新截图证明未配置源的中文反馈，未伪造可用版本。
- `delivery-verify.log`、`delivery.json`：安装包大小/SHA-256、构建配置/来源/源码指纹、包内版本/通道与完整构建输出逐字节核对。
- `evidence-manifest.json`：本目录交付证据的大小与 SHA-256（排除清单自身）。
- `scope.log`、`diff-check.log`、`documentation-links.log`：差异边界、格式与本轮文档链接校验。
- `load-first-failure.log`、`updater-first-failure.log`：首次工具烟测失败记录，根因和修正在阶段 6 报告列出，不能当最终通过证据。

JSON 中的随机临时绝对数据根在归档副本中替换为明确标记；原始命令输出日志按实际字节保留。安装包在 `artifacts/desktop/stage-6/`，完整运行输出在 `artifacts/smoke/`，均不提交用户数据或签名材料。

原始日志中的 Electron NativeImage / macOS task_policy_set 提示按实际输出保留；本轮自动化断言及退出码通过不等于这些原生环境差异已在全部支持系统排除。
