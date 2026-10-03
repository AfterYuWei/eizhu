# eizhu 开发指南

eizhu 是基于 React、Tauri 2 与 Rust 的 SSH/SFTP 客户端。当前发布桌面版本，Rust
核心与 Tauri mobile entry 为 Android/iOS 复用预留。所有业务领域都在 Tauri 进程内运行，
前端通过细粒度 command 与 event 通信，不启动本地服务进程。

## 开发环境

- Node.js 22+
- Rust 1.89+
- 各平台的 Tauri 2 系统依赖

```bash
npm ci
npm --prefix web ci
make dev
```

`make dev` 会同时启动 Vite 与 Tauri/Rust 后端，可测试 SSH、SFTP 和持久化功能。仅调试
React 界面时可使用 `make web-dev`；该模式不提供 Tauri IPC，不能执行连接测试等原生功能。

## 验证

```bash
npm --prefix web run test:unit
npm --prefix web run lint
npm --prefix web run build
cd src-tauri
cargo fmt --all -- --check
cargo check --locked
cargo clippy --all-targets --all-features --locked -- -D warnings
cargo test --locked
```

生产构建使用 `npm run desktop:build`。React 产物位于 `web/dist`，由 Tauri 直接打包。

## 架构

Rust 入口在 `src-tauri/src/lib.rs`，`app/bootstrap.rs` 按顺序初始化 SQLite、凭据加密、
审计、Profile/Vault/Group/Snippet、备份与同步、SSH 会话和 SFTP 会话。

- `commands/`：全部 Tauri IPC adapter；不执行 SQL、加密或底层 SSH/SFTP 流程。
- `infrastructure/database/`：SQLite schema、兼容迁移、WAL 与 busy timeout。
- `profile/`、`vault/`、`group/`、`snippet/`、`audit/`：本地 feature 与各自 repository。
- `backup/`：完整版本和隔离恢复；`backup/archive/`：第三方/官方对象备份、OAuth 与独立调度。
- `sync/`：账号条目加密、事务队列、实时提交、SSE、差异与冲突。
- `app/workspace.rs`：账号空间隔离、装配和任务退出，协议与数据迁移见 `docs/DATA_SYNC.md`。
- `ssh/transport.rs`：直连、SOCKS5、HTTP CONNECT、SSH jump 与认证。
- `ssh/session.rs`、`session_manager.rs`：PTY、终端 I/O、补全、host-key 与生命周期。
- `ssh/authentication.rs`：终端/隧道共用认证请求；`ssh/tunnel.rs`、`forwarding.rs`、`socks.rs`：三类隧道、回传通道与 SOCKS5。
- `local_state/`：账号/服务器隔离的加密历史与本地配置；布局、传输和隧道均排除云同步/完整备份。
- `sftp/`：会话、文件操作、编辑、上传下载与跨会话传输。
- `app/events.rs`：SSH/SFTP feature event port 的 Tauri adapter。
- `infrastructure/platform/desktop/`：对话框、drag-out、日志、legacy path/settings。
- `server_detail.rs`：通过现有 SSH/SFTP 会话采集主机信息和运行指标。

完整依赖、错误、所有权和移动端边界见 `docs/RUST_ARCHITECTURE.md`。

React 的领域 API 位于 `web/src/api/`，统一使用 `invokeCommand`；实时消息由
`eizhu-session-message`、`eizhu-sftp-message` 等 Tauri event 承载。

## 数据与安全

数据保存在系统的 `eizhu` 用户目录：SQLite 数据库为
`eizhu.db`，主密钥为 `key`。账号空间有独立数据库、设备密钥和备份目录；原库作为本地空间保留，认证元数据位于 `application.db`。凭据只在 Rust 内存中解密，连接配置解析结构在析构时清零。
SSH 主机密钥以 SHA-256 指纹验证；未知指纹在成功连接后保存，变化时要求用户确认。

## 前端约定

- 用户可见文本保持中文。
- 新组件优先使用 `web/src/components/ui/` 中的 shadcn/ui。
- 颜色使用语义 CSS 变量，圆角与 `DESIGN.md` 一致。
- 类名合并使用 `cn()`。
- Profile/Group 图标只能使用 `web/src/lib/serverIcons.tsx` 与 `groupIcons.tsx` 的稳定 key。

## 桌面改造回归与原生验收

本轮实现与提交记录见 [DESKTOP_ROADMAP.md](DESKTOP_ROADMAP.md)，交付状态和原生验收步骤见 [DESKTOP_DELIVERY.md](DESKTOP_DELIVERY.md)。不运行本地完整构建时，可单独执行 TypeScript 静态检查：

```bash
node --test scripts/*.test.mjs
./web/node_modules/.bin/tsc --noEmit -p web/tsconfig.app.json
./web/node_modules/.bin/tsc --noEmit -p web/tsconfig.node.json
cd src-tauri
cargo test --all-features --locked --lib
```

SSH/SFTP 协议测试使用进程内回环服务，执行环境必须允许监听回环地址。指标沿用现有收集器，仅可见详情按三秒轮询；后台和侧栏折叠停止后续采样，内存只保留每主机最近 120 个紧凑样本，账号切换清空。完整构建、桌面烟测和安装更新由远端 CI 及原生验收完成。
