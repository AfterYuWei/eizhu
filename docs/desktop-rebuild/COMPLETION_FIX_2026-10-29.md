# Electron 终端补全迁移排查

2026-10-29，本地 `dev` 工作区的迁移修复验收记录，未发布。历史对照为固定基线 `d8a20e0f77ab04af4a4a729f94884a68c4022a5f` 的 `src-tauri/src/ssh/session.rs`，只读检查，没有修改固定证据。

本页记录首次迁移修复；后续全部补全的测试矩阵、追加修复、安装包复验和 4 项未通过的上下文缺口见[完整测试报告](COMPLETION_TEST_REPORT_2026-10-29.md)。

## 根因与修复

1. **动态候选请求在 IPC 边界被拒绝。** `getDynamicGenerator()` 返回的对象还包含前端使用的 `parser`、`cacheTtl`、`dirsOnly`。`sessionApi.complete()` 原样展开该对象，违反 `session.complete` 的严格输入 schema，导致路径、Git 分支、npm 脚本等动态候选不可用。新增测试使用真实生成器结果和真实 schema，修复前复现 `unrecognized_keys`。现只发送 `generatorId`、`params`、所属会话、请求 ID 和工作目录，保留严格校验。

2. **当前目录跟踪的 Shell 初始化遗漏。** Rust 版会识别 Bash/Zsh/Fish 并安装当前会话的 OSC 7 钩子；Electron 版只解析 OSC 7，没有安装钩子。默认不主动上报目录的服务器在 `cd` 后仍按主目录查询路径、Git 等候选。现恢复会话内钩子，先打开交互通道保留登录横幅，再识别 Shell；收到初始化确认后开放终端输入。按行隐藏分块/重复的初始化回显，保留原始终端字节、中文与 emoji。未知 Shell 或禁止辅助 exec 时继续使用终端，不发送不兼容语法；确认等待及缓冲均有上限，关闭、取消、重连释放等待。

`git` 命令及 `git ` 子命令属于静态候选，未发现规格丢失。输入交互回归已覆盖逐字输入 `g`、`i`、`t`、空格，再输入 `checkout ` 并合入远端分支，以及旧连接响应隔离和 Tab 透传。

## 验证

| 检查 | 结果 |
| --- | --- |
| 类型、完整 lint、差异空白检查 | 通过 |
| Web 回归 | 318 项通过；扩充后的 Git 输入交互与 IPC 回归另行通过 |
| Foundation 回归 | 133 项通过，1 项跳过；沙箱内首次有 6 项因 `listen EPERM` 失败，允许本机回环监听后重跑通过 |
| Shell 实测 | 本机 Bash、Zsh 在中文/空格目录中 `cd` 后更新路径；Fish 未安装，执行项跳过 |
| 固定兼容 | `baseline:verify` 与 10 项 `baseline:test` 通过，固定样本未修改 |
| Electron 构建输出烟测 | macOS x64 完整进程树通过；合成 SSH 增加无原生目录上报的 Bash 初始化、回显隐藏、目录变化事件、相对路径及 Git 使用新 cwd、重连输入不重放检查 |
| 最终安装包烟测 | 通过；从未签名的 `eizhu-0.5.0-test.352.049b3b3a-mac-x64.dmg` 挂载、复制到临时目录后运行完整烟测，`packaged=true`。证据位于 `artifacts/smoke/darwin-x64.json` |

未连接用户的真实服务器；Windows x64、macOS arm64、Linux x64、本机 Fish、签名/公证与真实更新仍待验。合成 SSH 通过不等同于这些环境验收。
