# eizhu

跨平台桌面 SSH 终端与 SFTP 客户端，使用 Electron、React 与 TypeScript/Node.js。
保留现有桌面界面设计与操作，使用全新数据目录和数据库；通过文件备份和第三方云目标交换业务数据。

当前基础版本为 **0.6.0**，更新与升级事项见 [发布说明](docs/releases/0.6.0.md)。已接通服务器、分组、凭据、命令片段、加密存储、审计、OpenSSH 密钥生成和旧备份导入导出。
已接通 SSH 认证与路由、指纹确认、终端、补全、历史、隧道和服务器指标；支持本机/SFTP 文件操作、流式传输、检查点恢复及独立编辑器安全保存。自动备份生成本地可导入文件并上传到启用的第三方云目标，旧版本管理与安全快照恢复已移除。账号[同步引擎](docs/desktop-rebuild/SYNC_ENGINE_2026-10-28.md)支持主密码、首次预览、加密增量、SSE 与冲突恢复；[本机测试后端](docs/desktop-rebuild/LOCAL_SYNC_ACCEPTANCE_2026-10-28.md)双端验收范围及生产复验边界分别记录。账号同步与离线/第三方备份独立管理，官方云备份尚未开放。
完整功能范围、兼容样本与验收状态见 [桌面实施记录](docs/desktop-rebuild/README.md)。

新增 [AI Agent v2](docs/desktop-rebuild/AI_AGENT_V2_2026-11-05.md)：连接服务器后打开右上角“右侧栏”并选择“AI”，使用内置多供应商或外部 Agent，通过统一权限和审批在现有 SSH 终端执行操作。配置与历史在本机加密保存，官方网关按 [接口契约](docs/AI_API.md) 单独部署。升级时旧 AI 配置与历史会一次性清除，请重新配置。
历史阶段结果见 [阶段 6 报告](docs/desktop-rebuild/STAGE_6_REPORT.md)，当前功能边界见 [验收矩阵](docs/desktop-rebuild/ACCEPTANCE.md)。正式发布经 [四目标发布门禁](docs/RELEASE_CHECKLIST.md)，实际执行结果以对应 GitHub Release 和随包报告为准。

```bash
# Node 24 LTS
npm ci
npm run desktop:dev

npm run check
npm run lint
npm test
npm run baseline:verify
npm run architecture:verify
npm run desktop:build
npm run desktop:package
npm run desktop:smoke:package -- <安装包路径>
```

Windows x64：NSIS；macOS arm64/x64：分别打包 DMG/ZIP；Linux x64：AppImage、deb、rpm。
品牌和 `com.yuweinfo.eizhu` 保持现状，版本仅从根目录 `VERSION` 读取。首个 Electron 版本需手动安装。

- [开发指南](docs/DEVELOPMENT.md) / [架构](docs/ARCHITECTURE.md) / [维护规范](AGENTS.md)
- [桌面设计事实](DESIGN.md) / [备份兼容](docs/BACKUP.md) / [第三方云备份](docs/BACKUP_CLOUD.md) / [安全](docs/SECURITY.md)
- [SFTP 与编辑器](docs/SFTP_API.md) / [同步协议](docs/DATA_SYNC.md) / [发布与 CI](docs/DESKTOP_DELIVERY.md)

仓库只维护桌面应用；`admin/` 是独立闭源服务端仓库。
