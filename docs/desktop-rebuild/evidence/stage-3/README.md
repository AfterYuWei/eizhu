# 阶段 3 证据

记录日期：2026-10-20。仅计本机 macOS x64 实际执行，全部使用临时数据目录、本机合成 SSH/代理/回显服务，不访问用户服务器或真实凭据。

- `check.log`、`lint.log`、`test.log`：类型、lint、244 项回归。
- `baseline.log`、`architecture.log`、`diff-check.log`：固定样本只读、工程边界及空白检查。
- `build.log`、`build-smoke.log`、`mac-x64-build-smoke.json`：最终构建与真实 Electron SSH/隧道/原生数据库 Worker 验证。
- `package.log`、`package-smoke.log`、`mac-x64-package-smoke.json`：最终 DMG 与解包后的同套进程树烟测。
- `delivery.json`：阶段 3 涉及源文件和测试产物摘要、分支/基线提交、执行目标及待验项。

JSON 中 `stage3` 是真实 SSH 握手与二进制/隧道链路；`stage3Storage` 是 Electron utilityProcess 下数据库 Worker 的原生 SQLite 测试。`stage2` 继续验证旧备份及故障回滚。合成 metrics 输出只验证解析与请求链，不是 Linux 服务器实测；界面截图仍是首页/编辑器证据，不替代真实终端和分屏人工交互。

测试包保存在 `artifacts/desktop/stage-3/`，未签名/公证/发布。阶段 2 既有差异保持未提交。其他平台、真实 Agent/多因素/IPv6、多平台交互、真实更新与长期性能仍待验，详情见上级阶段报告。
