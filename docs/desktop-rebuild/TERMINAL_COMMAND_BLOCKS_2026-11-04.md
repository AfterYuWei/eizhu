# 终端命令与输出范围标识

2026-11-04：按用户要求替换命令输入改色功能。每条命令及其对应输出在终端右侧形成一条连续竖条，下一次执行单独成块。

## 变更

- 删除命令文字的强调色以及浅色主题普通文本变灰的逻辑，所有终端主题使用原始调色板。独立的日志关键词补色开关保留，默认关闭。
- 沿用 OSC 133 命令边界，在终端文字区域外绘制 2px 中性竖条。命令续行、软换行和输出内部空行属于同一块；相邻执行之间留出小间隔。
- 标识随滚动、窗口重排和主题切换更新；长输出即使命令已被滚动缓冲淘汰，仍保留对应输出的标识。空提示符、没有可靠命令边界的内容及备用屏幕不显示。
- 设置文案改为“命令块标识”，复用原有启用偏好键 `terminalCommandHighlight`，不引入数据库迁移。竖条不进入终端文本、复制内容或输入流，不拦截鼠标操作。
- 更新高亮回归和现有桌面烟测的命令块、日志独立开关与偏好保存断言。

## 本轮验证

- `npm run check`、`npm run lint`、`git diff --check`：通过。
- 终端标识、TerminalPane、设置页定向回归：3 个文件、19 项通过。
- `npm run baseline:verify`：固定 39 个用例、37 个资产通过，未改写样本。
- `npm run desktop:build`：macOS x64 构建通过。
- `npm run desktop:smoke`：macOS x64 实际 Electron 进程树通过；本地合成 SSH 验证命令与输出共 5 行、2 个独立块，以及标识/日志开关、偏好保存与返回设置后终端保留，结果 `stage3.completionUi.terminalCommandBlocks: true`。
- 独立 Electron/WebGL：浅色 One Light 与默认深色各验证 3 次执行、9 行连续标识；关闭开关不改变原配色，缩窄后仍保持 3 个命令块，竖条位于文字区域外。

本地渲染证据使用合成终端字节：[浅色](../../artifacts/terminal-blocks-20261104/one-light.png)、[深色](../../artifacts/terminal-blocks-20261104/default.png)、[检查结果](../../artifacts/terminal-blocks-20261104/report.json)。复验脚本保存在忽略目录 `.tmp/terminal-block-preview.mjs`，仅使用已安装的 Vite、Electron 和 xterm。

应用内证据：[终端](../../artifacts/smoke/darwin-x64/terminal-highlighting-shell.png)、[设置](../../artifacts/smoke/darwin-x64/terminal-highlighting-settings.png)、[完整烟测报告](../../artifacts/smoke/darwin-x64.json)。

本轮未进行真实服务器 Shell 组合、其他平台及最终安装包验收。
