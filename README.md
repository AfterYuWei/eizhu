<p align="center">
  <img src="src-tauri/app-icon.png" width="112" alt="eizhu 图标">
</p>

<h1 align="center">eizhu</h1>

<p align="center">
  一个使用 Tauri 2、Rust 与 React 构建的跨平台 SSH 终端和 SFTP 客户端。
</p>

<p align="center">
  <a href="https://github.com/AfterYuWei/eizhu/actions/workflows/quality.yml"><img src="https://github.com/AfterYuWei/eizhu/actions/workflows/quality.yml/badge.svg" alt="Quality"></a>
  <a href="https://github.com/AfterYuWei/eizhu/releases/latest"><img src="https://img.shields.io/github/v/release/AfterYuWei/eizhu" alt="GitHub Release"></a>
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License">
</p>

eizhu 将终端、服务器管理、SFTP、凭据和备份同步集中在一个原生应用中。界面由 React
渲染，SSH/SFTP、SQLite、加密、备份及同步逻辑全部运行在 Rust 进程内；应用不会在本机启动
HTTP 或 WebSocket 服务。

## 主要功能

### SSH 终端

- 多会话标签页、终端主题、字体设置和移动端快捷键工具栏。
- 支持密码、私钥和密码库凭据认证，以及 keyboard-interactive 交互认证。
- 支持直连、SOCKS5、HTTP CONNECT 和多级 SSH 跳板连接。
- 正式连接校验并保存 SSH 主机 SHA-256 指纹，指纹变化时要求用户确认。
- 连接后读取服务器信息与 CPU、内存、磁盘、网络等运行指标。
- 自动识别 fnOS、Proxmox VE、TrueNAS、Synology、QNAP、Unraid、主流 Linux
  发行版等系统或产品，并显示对应图标。

### SFTP 文件管理

- 双栏、多标签文件浏览，可在本地、远端以及不同服务器之间传输文件。
- 支持上传、下载、新建、重命名、删除、复制、移动和批量选择。
- 支持拖放操作、传输队列、冲突处理和目录递归传输。
- 内置文本编辑器，可直接打开并保存远程文本文件。
- 桌面端支持把远程文件拖出到系统；移动端通过系统文件选择器导入或导出文件。

### 服务器与凭据

- 按分组、标签和自定义顺序管理服务器。
- 名称可以留空并自动使用主机地址，连接配置支持独立测试。
- 密码库统一保存密码、私钥等凭据，敏感字段在 Rust 内存中解密并在使用后清零。
- 同一份凭据可以被多个连接配置复用，避免重复维护。

### 备份与同步

- 导出和导入 `.eizhubackup`，并兼容历史 XControl `.xcbackup` 备份。
- 支持本地版本、定时备份、变更触发备份、历史恢复和冲突处理。
- 支持 WebDAV、S3 兼容存储、Google Drive 和 OneDrive。
- 云同步版本使用同步密码派生密钥并加密后上传。

### 桌面与移动端

- 桌面构建覆盖 Windows x64、macOS Apple Silicon 和 Linux x64。
- Linux 提供 AppImage、deb 和 rpm，Windows 提供安装程序，macOS 提供 dmg。
- 桌面端支持正式版与测试版更新通道。
- Android/iOS 共用 Rust 核心和移动端界面；当前仍处于持续真机与商店发布门禁验证阶段，
  详见 [移动端发布说明](docs/MOBILE_RELEASE.md)。

## 下载

### 正式版（Stable）

[![正式版](https://img.shields.io/badge/正式版-v0.4.1-2ea44f)](https://github.com/AfterYuWei/eizhu/releases/tag/v0.4.1)

正式版由 `main` 分支发布，优先保证稳定性，适合日常使用。点击对应平台徽标即可直接下载安装包：

<p>
  <a href="https://github.com/AfterYuWei/eizhu/releases/download/v0.4.1/eizhu_0.4.1_x64-setup.exe"><img src="https://img.shields.io/badge/Windows-x64-0078D4?logo=windows11&amp;logoColor=white" alt="下载 Windows x64 正式版"></a>
  <a href="https://github.com/AfterYuWei/eizhu/releases/download/v0.4.1/eizhu_0.4.1_aarch64.dmg"><img src="https://img.shields.io/badge/macOS-Apple_Silicon-000000?logo=apple&amp;logoColor=white" alt="下载 macOS Apple Silicon 正式版"></a>
  <a href="https://github.com/AfterYuWei/eizhu/releases/download/v0.4.1/eizhu_0.4.1_amd64.AppImage"><img src="https://img.shields.io/badge/Linux-AppImage-FCC624?logo=linux&amp;logoColor=black" alt="下载 Linux AppImage 正式版"></a>
  <a href="https://github.com/AfterYuWei/eizhu/releases/download/v0.4.1/eizhu_0.4.1_amd64.deb"><img src="https://img.shields.io/badge/Linux-deb-A81D33?logo=debian&amp;logoColor=white" alt="下载 Linux deb 正式版"></a>
  <a href="https://github.com/AfterYuWei/eizhu/releases/download/v0.4.1/eizhu-0.4.1-1.x86_64.rpm"><img src="https://img.shields.io/badge/Linux-rpm-294172?logo=fedora&amp;logoColor=white" alt="下载 Linux rpm 正式版"></a>
</p>

[查看正式版发布说明](https://github.com/AfterYuWei/eizhu/releases/tag/v0.4.1) ·
[始终前往最新正式版](https://github.com/AfterYuWei/eizhu/releases/latest)

### 测试版（Preview）

[![测试版](https://img.shields.io/badge/测试版-0.4.1--test.223.d042070-f59e0b)](https://github.com/AfterYuWei/eizhu/releases/tag/test-v0.4.1-test.223.d042070)

测试版由 `dev` 分支持续发布，会更早包含新功能和问题修复，适合参与测试；使用过程中可能出现
尚未发现的问题。下方徽标固定对应其标注的测试版本，点击即可直接下载：

<p>
  <a href="https://github.com/AfterYuWei/eizhu/releases/download/test-v0.4.1-test.223.d042070/eizhu_0.4.1-test.223.d042070_x64-setup.exe"><img src="https://img.shields.io/badge/Windows-x64-0078D4?logo=windows11&amp;logoColor=white" alt="下载 Windows x64 测试版"></a>
  <a href="https://github.com/AfterYuWei/eizhu/releases/download/test-v0.4.1-test.223.d042070/eizhu_0.4.1-test.223.d042070_aarch64.dmg"><img src="https://img.shields.io/badge/macOS-Apple_Silicon-000000?logo=apple&amp;logoColor=white" alt="下载 macOS Apple Silicon 测试版"></a>
  <a href="https://github.com/AfterYuWei/eizhu/releases/download/test-v0.4.1-test.223.d042070/eizhu_0.4.1-test.223.d042070_amd64.AppImage"><img src="https://img.shields.io/badge/Linux-AppImage-FCC624?logo=linux&amp;logoColor=black" alt="下载 Linux AppImage 测试版"></a>
  <a href="https://github.com/AfterYuWei/eizhu/releases/download/test-v0.4.1-test.223.d042070/eizhu_0.4.1-test.223.d042070_amd64.deb"><img src="https://img.shields.io/badge/Linux-deb-A81D33?logo=debian&amp;logoColor=white" alt="下载 Linux deb 测试版"></a>
  <a href="https://github.com/AfterYuWei/eizhu/releases/download/test-v0.4.1-test.223.d042070/eizhu-0.4.1-test.223.d042070-1.x86_64.rpm"><img src="https://img.shields.io/badge/Linux-rpm-294172?logo=fedora&amp;logoColor=white" alt="下载 Linux rpm 测试版"></a>
  <a href="https://github.com/AfterYuWei/eizhu/releases/download/test-v0.4.1-test.223.d042070/eizhu-0.4.2-test.223.d042070-android-arm64-debug.apk"><img src="https://img.shields.io/badge/Android-arm64-3DDC84?logo=android&amp;logoColor=white" alt="下载 Android arm64 测试版"></a>
  <a href="https://github.com/AfterYuWei/eizhu/releases/download/test-v0.4.1-test.223.d042070/eizhu-0.4.2-test.223.d042070-ios-arm64-unsigned.ipa"><img src="https://img.shields.io/badge/iOS-arm64_未签名-000000?logo=apple&amp;logoColor=white" alt="下载 iOS arm64 未签名测试版"></a>
</p>

[查看测试版发布说明](https://github.com/AfterYuWei/eizhu/releases/tag/test-v0.4.1-test.223.d042070) ·
[查看全部发布记录](https://github.com/AfterYuWei/eizhu/releases)

> [!NOTE]
> macOS 当前只提供 Apple Silicon 版本。iOS 测试包未签名，不能直接安装，需要自行签名后侧载；
> Android/iOS 仍处于真机验证阶段。安装测试版前建议备份现有数据。

## 本地开发

### 环境要求

- Node.js 22+
- Rust 1.89+
- 当前平台所需的 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)

安装依赖：

```bash
npm ci
npm --prefix web ci
```

启动完整桌面应用：

```bash
npm run desktop:dev
```

也可以使用：

```bash
make dev
```

仅调试 React 界面时，可以运行：

```bash
make web-dev
```

浏览器模式没有 Tauri IPC，因此无法建立 SSH/SFTP 连接，也不能使用原生文件和更新能力。

## 构建与验证

构建桌面安装包：

```bash
npm run desktop:build
```

运行桌面运行时烟测：

```bash
npm run desktop:smoke
```

前端检查：

```bash
npm --prefix web run test:unit
npm --prefix web run lint
npm --prefix web run build
```

Rust 检查：

```bash
cd src-tauri
cargo fmt --all -- --check
cargo check --locked
cargo clippy --all-targets --all-features --locked -- -D warnings
cargo test --locked
```

移动端初始化和构建命令：

```bash
npm run android:init
npm run android:dev
npm run android:build

npm run ios:init
npm run ios:dev
npm run ios:build
```

签名、产物与真机验收要求分别见
[Android 构建说明](docs/ANDROID_APK_GITHUB.md)和[移动端发布说明](docs/MOBILE_RELEASE.md)。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 应用容器 | Tauri 2 |
| 前端 | React 19、TypeScript、Vite、Zustand、Tailwind CSS、Radix UI |
| 终端 | xterm.js、WebGL addon |
| 编辑器 | Monaco Editor |
| 后端 | Rust、Tokio |
| SSH / SFTP | russh、russh-sftp |
| 数据库 | SQLite（rusqlite） |
| 加密 | AES-256-GCM、Argon2id |

## 架构

```text
React UI
   │
   ├── Tauri command ── 查询与操作
   └── Tauri event   ── 终端输出与传输进度
                │
                ▼
Rust feature services
   ├── Profile / Vault / Group / Snippet
   ├── SSH session / SFTP transfer
   ├── Backup / Sync
   └── SQLite / platform adapters
```

主要目录：

```text
web/                         React / TypeScript 前端
web/src/api/                 Tauri command 封装
web/src/store/               Zustand 状态
src-tauri/src/commands/      Tauri IPC 适配层
src-tauri/src/ssh/           SSH 连接、会话与认证
src-tauri/src/sftp/          文件操作与传输
src-tauri/src/profile/       服务器连接配置
src-tauri/src/vault/         凭据与加密
src-tauri/src/backup/        备份格式与导入导出
src-tauri/src/sync/          云端 Provider 与版本同步
src-tauri/src/infrastructure/ SQLite 与平台能力
```

更完整的依赖边界和模块职责见 [Rust / Tauri 架构说明](docs/RUST_ARCHITECTURE.md)，开发约定见
[开发指南](docs/DEVELOPMENT.md)和 [DESIGN.md](DESIGN.md)。

## 数据与安全

- 应用数据保存在系统的 `eizhu` 用户数据目录中，不经过额外的本地网关。
- SQLite 数据结构、密钥文件和加密凭据格式保持向后兼容。
- 凭据使用本地随机主密钥和 AES-256-GCM 加密，解析后的敏感信息使用后主动清零。
- 正式 SSH/SFTP 会话严格校验主机指纹；“测试连接”只报告当前指纹，不写入或修改信任记录。
- 手动导出的 `.eizhubackup` 可能包含明文密码和私钥，请将它视为敏感文件妥善保存。
- 云同步版本与手动导出是两条不同路径：云端版本会使用同步密码进行加密。

## 参与贡献

欢迎通过 [Issues](https://github.com/AfterYuWei/eizhu/issues) 报告问题或提出建议。提交代码前请运行
前端与 Rust 的完整检查，并保持用户界面文案为中文。

## 许可证

项目代码按 MIT 许可证发布。第三方库及品牌图标分别遵循其自身的许可证和商标规则；品牌资源
仅用于识别对应的服务器产品或操作系统。
