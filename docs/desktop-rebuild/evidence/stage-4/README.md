# 阶段 4 证据索引

- `mac-x64-build-smoke.json`：最终构建的 Electron 进程树、OpenSSH 文件子系统、编辑器、归档及数据库恢复。
- `mac-x64-package-smoke.json`：从最终 DMG 提取后运行的同套烟测。
- `delivery.json`：源文件、安装包、构建输出与证据摘要；平台执行及待验项。
- `checks.txt`：类型、lint、完整回归、固定基线和架构校验的原始记录。
- `mac-x64-sftp.png`、`mac-x64-editor.png`：真实双栏文件页/完成队列及未保存编辑器；文件全部来自临时合成环境。

测试包及详细日志位于 `artifacts/desktop/stage-4/`。JSON 中的本机临时数据根已去除；测试使用受限临时文件密钥，不是系统密钥库验收。缺少 OpenSSH 测试子系统的目标明确记录 unavailable，不计为阶段 4 协议通过。
