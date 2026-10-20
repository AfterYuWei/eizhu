# eizhu

跨平台桌面 SSH 终端与 SFTP 客户端，使用 Electron、React 与 TypeScript/Node.js。
保留现有桌面界面设计与操作，使用全新数据目录和数据库；通过备份及现有云端协议交换业务数据。

当前交付为**阶段 1：桌面工程基础**，包含受限 preload、独立业务进程、数据库/计算 Worker、新设置存储和本地编辑器资源。
服务器、凭据、SSH/SFTP、账号、同步和备份业务尚待阶段 2–5 实现；当前预留操作明确返回未开放错误。
完整功能范围、兼容样本与验收状态见 [桌面实施记录](docs/desktop-rebuild/README.md)。
阶段 1 四目标最终安装包烟测已通过，桌面外壳等待用户确认；源码、测试包及待验范围见 [阶段 1 报告](docs/desktop-rebuild/STAGE_1_REPORT.md)。

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
