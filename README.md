# eizhu

跨平台桌面 SSH 终端与 SFTP 客户端，使用 Electron、React 与 TypeScript/Node.js。
保留现有桌面界面设计与操作，使用全新数据目录和数据库；通过文件备份和第三方云目标交换业务数据。

当前进入**阶段 6：最终工程交付与发布验收**。阶段 0–5 的实现及历史证据已归档。已接通服务器/分组/凭据/片段、加密存储、审计、OpenSSH 密钥生成、旧备份导入导出和安全快照恢复。
已接通 SSH 认证与路由、指纹确认、终端、补全、历史、隧道和只读服务器详情。阶段 4 已接通本机/SFTP 文件操作、流式传输、检查点恢复和独立编辑器安全保存。阶段 5 已接通本地完整版本、自动备份、第三方云目标和 OAuth。账号对接已进入[第二批账号闭环](docs/desktop-rebuild/ACCOUNT_CLOSURE_2026-10-27.md)，接通登录注册、邮箱验证、密码找回、会话刷新与独立空间；条目同步、首次接入与同步开关仍返回 `STAGE_NOT_READY`。账号同步与离线/第三方备份分别管理，本轮不接入官方备份。
完整功能范围、兼容样本与验收状态见 [桌面实施记录](docs/desktop-rebuild/README.md)。
最终测试、候选包、差异和未执行项见 [阶段 6 报告](docs/desktop-rebuild/STAGE_6_REPORT.md) 和 [验收矩阵](docs/desktop-rebuild/ACCEPTANCE.md)。本轮仅交付本机候选，正式发布仍需通过 [发布门禁](docs/RELEASE_CHECKLIST.md)。

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
