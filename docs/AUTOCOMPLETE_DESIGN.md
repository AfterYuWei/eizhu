# 终端补全设计

桌面解析、静态规格、候选过滤和交互在 `apps/web/src/lib/completionEngine.ts`、`apps/web/src/hooks/useCompletion.ts`。共享 DTO 和启用 schema 位于 `packages/contracts/src/models/completion.ts` 与 `packages/contracts/src/ssh.ts`，远端执行在 `packages/core/src/ssh/completion.ts`。

`window.eizhu.session.complete` 只接受所属会话、请求 ID、固定 generatorId/params 和可选工作目录，不开放任意命令。主进程验证窗口及上下文，SSH 服务复核会话和请求；生成器使用白名单、严格 shell quoting、超时、取消和输出上限。

异步候选绑定会话、输入与工作目录，迟到响应不能覆盖新输入或新空间。中文输入、粘贴、TUI、Tab/方向键与现有提示语继续保留。合成远端及前端回归见阶段 3、6 报告；真实 IME/TUI 人工验收仍单列待验。

2026-10-29 修复了动态生成器前端配置误入严格 IPC 输入，以及 Bash/Zsh/Fish 当前目录钩子的迁移遗漏，排查及验证范围见[补全修复记录](desktop-rebuild/COMPLETION_FIX_2026-10-29.md)。

全部命令、生成器和交互的覆盖矩阵、实际 Electron 证据及 4 项上下文缺口见[完整测试报告](desktop-rebuild/COMPLETION_TEST_REPORT_2026-10-29.md)。
