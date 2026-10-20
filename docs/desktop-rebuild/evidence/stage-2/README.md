# 阶段 2 证据索引

日期：2026-10-20。均为合成测试或构建记录，不读取应用真实数据。当前仅执行 macOS x64；其他目标不计为本轮通过。

- `delivery.json`：基线提交、工作区变更源文件摘要、最终 DMG/ZIP 大小及 SHA-256、实际验证项与待验项。产物由未提交的阶段 2 工作区构建，未推送或发布。
- `check.log`、`lint.log`、`test.log`、`baseline.log`、`architecture.log`：类型、lint、236 项回归、只读固定样本及架构检查。
- `mac-x64-build-smoke.json`、`build-smoke.log`：构建输出的真实 Electron 进程树验证。
- `mac-x64-package-smoke-first.json`、`mac-x64-package-smoke.json`：同一最终 DMG 的两次全新临时目录烟测；`package-smoke-first.log`、`package-smoke.log` 保留阶段进度。JSON 已去除临时数据根路径。
- `mac-x64-home-light.png`、`mac-x64-home-dark.png`、`mac-x64-editor-empty.png`：最终包截图。明暗截图等待实际绘制，并核对侧栏像素亮度；不能将旧帧标成另一主题。
- `package.log`：当前平台实际打包记录，缺 Developer ID，未签名/公证。
- `initial-package-timeout.log`、`occluded-timeout.log`：早期烟测失败，均不计为通过。第二份定位到本地业务检查完成后的截图阶段。烟测窗口被遮挡可能暂停动画帧；修正只对合成烟测窗口关闭后台帧节流，加有界绘制等待并校验主题像素，不改变正常应用的后台策略。

数据库、KDF 和 OpenSSH 集成检查由 Electron utilityProcess 下的隔离测试 Worker 执行。JSON 中的 `workers: 2` 是常驻业务 Worker 数，集成检查另建并关闭临时测试 Worker。`firstWindowMs` 不是完整进程冷启动或性能门槛证据；内存快照包含测试编辑器和 Monaco 窗口。
