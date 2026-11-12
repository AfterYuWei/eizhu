# 滚动条统一与 SSH 重连输入修复（2026-11-12）

## 修改

- 原生滚动区、Radix、xterm 和 Monaco 使用约 6px 的圆角滑块；轨道透明，普通界面共用中性色和悬停、拖动色阶，终端继续使用自身配色。轨道宽度为 8px，保留拖动及滚轮操作，原有隐藏滚动条的区域继续隐藏。
- Chromium 的标准 `scrollbar-width` / `scrollbar-color` 会优先于 WebKit 自定义样式，因此在 Chromium 中恢复 `auto`，并移除各页面重复的 `thin` 声明，使圆角样式实际生效。
- SSH 重连保留会话 ID 和 MessagePort。原先通道收到 `exit`、`disconnect` 或 `error` 后一直保持断开，导致终端的输入检查继续拦截按键。现在随连接状态和就绪元数据恢复通道。
- 同 ID 重连的就绪事件可能先于重连请求响应到达。现在先标记连接中，响应只为新会话绑定 ID，避免将已经连接的终端覆盖回连接中。
- 桌面烟测新增 `--terminal-only` 入口，实际操作“更多操作 → 重新连接”两次，通过 xterm 键盘路径验证输入和回车已送达 SSH 对端。新增命令会进入历史，因此历史测试改为基于测试前数量校验新增与禁用行为。

## 已执行

- `npm run check`、`npm run lint`：通过。
- 前端全量单测：91 个文件、1052 项通过；新增重连回归在修复前先复现失败，修复后通过。
- `npm run baseline:verify`：39 个固定兼容案例通过，未刷新样本。
- `npm run baseline:test`：10 项通过。
- `npm run desktop:build`：通过。
- `npm run desktop:smoke -- --terminal-only`：macOS x64 通过；包含 71 项补全 UI 场景、两次手动重连后的键盘输入与回车、滚动条尺寸和圆角检查，以及连接、隧道、故障与资源释放检查。
- `npm run desktop:smoke:sftp`：macOS x64 通过；使用已安装的 OpenSSH 子系统，独立编辑器深浅主题、窄窗口和未保存内容保留通过。

证据位于 `artifacts/smoke/darwin-x64-terminal.json`、`artifacts/smoke/darwin-x64/scrollbar-terminal-{light,dark}.png` 和 `artifacts/sftp-smoke/darwin-x64/report.json`。

## 验证边界

完整 `desktop:smoke` 在未修改的 AI UI 阶段遇到 `Cannot read properties of null (reading 'dispatchEvent')`，未到达 SSH 阶段，不标记整套通过。终端和 SFTP/编辑器分别通过独立入口完成验证。

终端使用本机合成 SSH 对端确认输入传输，未连接生产服务器，也未验证真实服务器上的业务命令。Windows、Linux、macOS arm64 与最终安装包本轮未复验；本轮未下载测试二进制。
