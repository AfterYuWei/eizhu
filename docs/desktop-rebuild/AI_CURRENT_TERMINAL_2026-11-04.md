# AI 命令在当前 SSH 窗口执行

日期：2026-11-04。按用户要求，AI 命令复用当前 SSH 窗口的交互式 shell，不再创建独立的 SSH exec 执行通道。以下规则替代 2026-11-01 报告中“独立 exec、非交互 sh、关闭 stdin”的执行方式。

## 行为与差异

- 用户仍逐条确认命令，授权继续绑定实际窗口、会话和 SSH 连接实例；复制命令、模型测试、切换侧栏均不执行命令。
- 命令和输出在当前终端展示，确认后焦点回到该终端。内部结果标记和包装命令不在终端回显。
- 在当前 shell 中切换至提议中展示的绝对目录并执行命令，沿用已有变量、别名和函数；命令的目录及环境修改继续留在当前终端。支持多行命令、引号、Unicode 和制表符，不将其作为 readline 的回车或补全键发送。
- 用户在当前终端完成密码和其他交互输入。PTY 标准输出与错误输出合并，AI 结果放在 stdout，stderr 留空；结果继续回传模型分析，下一条仍需确认。
- 仅在收到 shell 空闲提示标记且无未提交输入时派发，同一终端至多执行一条 AI 命令。程序运行中、输入未提交或 shell 集成不可用时明确拒绝，不降级到独立执行。
- 停止和超时向当前终端发送 Ctrl+C，保留 shell 和 SSH 连接；不保证远端进程已经结束，结果未知时不自动重放。断开、重连与历史恢复继续使旧授权失效。
- 每次请求模型前刷新当前终端目录和上下文；已保存的旧执行方式提示在发送时替换为当前规则。存储、IPC DTO、数据库 schema、账号同步和备份范围不变。

## 验证

- 类型、lint、固定兼容与架构检查通过。
- 完整回归：基础 208 通过、2 项 Fish 环境跳过；前端 941 通过；固定兼容 10 通过。随后新增内部回显用例并定向复验：40 通过、2 项 Fish 环境跳过。
- 本机回环 SSH 协议测试确认只复用一个 shell、AI 零 exec 请求；实际安装的 Bash、Zsh 交互 shell 验证目录、变量、别名、函数延续及手动 stdin，另验证输出上限、分片 UTF-8、退出码、取消、超时、断开和取消前零派发。
- Electron 构建版完整烟测通过，覆盖确认前零执行、重复确认拒绝、当前终端执行、非零退出码与结果回传、未提交手动输入拦截，以及历史、加密存储和原有 SSH/SFTP 主流程。
- 最终 macOS x64 未签名 DMG `eizhu-0.5.0-test.373.e282a43a-mac-x64.dmg` 安装包完整烟测通过，解包后的源码摘要与当前构建一致：`0f8543c53d8f8109e903ce15532960e1507f0de539b75ea05a58cbfb6ddaaa8c`。DMG SHA-256：`855b154ee08073b0406a9ccf815a91d83be622ae923793cc63b5f95b7995b9c4`。
- [精简验收记录](evidence/ai-current-terminal-20261104/darwin-x64.json)；[明亮](evidence/ai-current-terminal-20261104/ai-chat-light.png)、[深色](evidence/ai-current-terminal-20261104/ai-chat-dark.png)、[窄窗口](evidence/ai-current-terminal-20261104/ai-chat-narrow.png)、[逐条确认](evidence/ai-current-terminal-20261104/ai-chat-approval.png)。已实际检查明亮截图，终端显示原始命令和输出，未显示内部包装。
- 打包验证结束后，确认项目应用副本及临时安装测试副本无运行进程，注销并删除 `artifacts/desktop/mac/eizhu.app`；`/Applications/eizhu.app` 和用户数据未改动。

## 待验

本机未安装 Fish，相关真实 shell 测试跳过；未识别 shell 或缺少 shell 集成时需手动执行。当前实际 shell 测试通过管道连接本机交互 shell，Electron SSH/模型使用隔离的本机合成服务，不能替代真实远端 PTY、sudo、全屏程序及中断行为验收。Windows x64、macOS arm64、Linux x64、签名/公证、真实供应商与长时间运行待验。本轮未推送、未发布。
