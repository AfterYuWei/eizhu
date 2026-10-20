# eizhu

跨平台桌面 SSH 终端与 SFTP 客户端，使用 Electron、React 与 TypeScript/Node.js。
保留现有桌面界面设计与操作，使用全新数据目录和数据库；通过备份及现有云端协议交换业务数据。

阶段 1–3 已获用户验收，当前交付为**阶段 4：SFTP 与编辑器**。已接通服务器/分组/凭据/片段、加密存储、审计、OpenSSH 密钥生成、旧备份导入导出和安全快照恢复。
已接通 SSH 认证与路由、指纹确认、终端、补全、历史、隧道和只读服务器详情。阶段 4 已接通本机/SFTP 文件操作、流式传输、检查点恢复和独立编辑器安全保存。账号、同步、自动备份与云端目标属于阶段 5，尚未开放的操作继续明确返回未就绪错误。
完整功能范围、兼容样本与验收状态见 [桌面实施记录](docs/desktop-rebuild/README.md)。
当前测试结果、界面差异及未执行的平台见 [阶段 4 报告](docs/desktop-rebuild/STAGE_4_REPORT.md)；前阶段证据见 [阶段 2 报告](docs/desktop-rebuild/STAGE_2_REPORT.md)；阶段 1 四目标证据保留在原报告中。

```bash
# Node 24 LTS
npm ci
npm run desktop:dev

npm run check
npm run lint
npm test
npm run baseline:verify
npm run desktop:build
npm run desktop:package
npm run desktop:smoke:package -- <安装包路径>
```

Windows x64：NSIS；macOS arm64/x64：分别打包 DMG/ZIP；Linux x64：AppImage、deb、rpm。
品牌和 `com.yuweinfo.eizhu` 保持现状，版本仅从根目录 `VERSION` 读取。首个 Electron 版本需手动安装。

- [开发指南](docs/DEVELOPMENT.md) / [架构](docs/ARCHITECTURE.md) / [维护规范](AGENTS.md)
- [桌面设计事实](DESIGN.md) / [备份兼容](docs/BACKUP.md) / [安全](docs/SECURITY.md)
- [SFTP 与编辑器](docs/SFTP_API.md) / [同步协议](docs/DATA_SYNC.md) / [发布与 CI](docs/DESKTOP_DELIVERY.md)

仓库只维护桌面应用；`admin/` 是独立闭源服务端仓库。
