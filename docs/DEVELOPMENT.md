# 开发指南

使用 Node 24 LTS、npm 和平台原生编译工具；Electron 运行时随安装包分发。执行一次根目录 `npm ci`，不要为子工作区生成锁文件。
Windows 使用受支持的 Visual Studio C++ 工具，macOS 使用 Xcode Command Line Tools，Linux 需要支持 C++20 `std::source_location` 的 Clang 15+、Python、GTK/NSS、密钥库运行库及打包工具。Linux 原生重建与打包统一默认 Clang，显式 CC/CXX 配置继续生效；Ubuntu 22.04 CI 明确设置 `CC=clang-15`、`CXX=clang++-15`，不使用系统默认的 Clang 14。
Electron 44 的 npm 包提供显式安装器；根 postinstall 会先运行官方安装器并校验分发包，再按 Electron ABI 重建原生模块，不能以 npm 依赖目录存在推断桌面运行时已安装。
`npm run desktop:dev` 启动 electron-vite 和桌面应用。开发目录为系统应用数据根下 `eizhu-desktop-dev`，安装版为 `eizhu-desktop`，两者均不读取旧目录。

`npm run check` 检查全工作区类型，`npm run lint` 检查 TypeScript 与前端规范，`npm test` 运行基础设施、桌面 UI/适配器和固定兼容回归。
`npm run baseline:verify` 从冻结 Git revision 取证；CI checkout 必须保留该提交历史。固定样本不是当前数据库，也不允许普通验证刷新。

Electron 或原生依赖变化后执行 `npm run native:rebuild`。Node 和 Electron 的原生 ABI 不可互相替代；数据库与原生 KDF 必须在 Electron 进程树中烟测。
`npm run desktop:build` 输出 `apps/desktop/out`，`npm run desktop:package` 输出 `artifacts/desktop`。
`npm run desktop:smoke` 使用隔离临时目录验证构建输出；最终产物用 `npm run desktop:smoke:package -- <安装包>`。
烟测 JSON 保存在 `artifacts/smoke/<platform>-<arch>.json`，截图保存在同名子目录；CI 一并归档。不能使用早于当前源码的报告作为最终验证。
Linux GUI 烟测需要 X11 显示环境，可使用 `xvfb-run`，不得通过关闭窗口沙箱来绕过配置错误。

当前已开放阶段 1 基础能力、阶段 2 本地领域/文件备份/安全快照、阶段 3 SSH/终端/隧道/详情、阶段 4 SFTP/传输/独立编辑器、阶段 5 本地版本/第三方云备份及阶段 6 更新客户端。阶段 2 的七份固定旧备份、十份反例、真实 SQLite 事务故障、三种 OpenSSH 密钥和密钥重启检查在 Electron utilityProcess 下的隔离数据库 Worker 执行，并覆盖最终安装包；`npm test` 不以 Node 加载原生模块代替这些检查。
领域实现时先定义运行时 schema 和归属规则，再接通仓储/协议适配，最后启用 preload 方法。
不增加通用 command 兼容层，不编写旧数据库迁移，不让测试替身进入正式启动路径。
各阶段需提交截图/交互差异、测试结果、平台未验证项，经用户确认后继续。

阶段 3 烟测在隔离 Electron 进程树内启动本机合成 SSH、代理与回显服务，覆盖认证/路由、二进制终端、指纹失效、隧道端口释放及加密历史；不连接真实服务器或使用用户凭据。最终安装包必须运行同一烟测。详见 [阶段 3 报告](desktop-rebuild/STAGE_3_REPORT.md)。

阶段 4 在同一进程树中用本机 `sftp-server` 执行真实 OpenSSH 文件子系统，SSH 握手由合成回环服务承载，所有文件与检查点位于临时数据根。测试工具不属于用户运行依赖；缺少此工具时报告阶段 4 协议集成待验，不标为通过。安装包同样执行安全保存、分块续传、归档、编辑器权限/未保存关闭和真实数据库重启恢复。详见 [阶段 4 报告](desktop-rebuild/STAGE_4_REPORT.md)。

阶段 5 继续使用完整 Electron 进程树，烟测在临时数据根启动合成 WebDAV/S3 服务，经主窗口 → preload → main → utilityProcess → 数据库/计算 Worker，网络走 Electron net.fetch，覆盖独立目标确认、ETag 冲突、索引响应丢失及手动恢复、密码轮换、变更防抖和重启。OAuth 单元测试监听临时回环端口。真实云厂商账号/租户、代理和 OAuth 同意流程单列待验，见 [阶段 5 报告](desktop-rebuild/STAGE_5_REPORT.md)。

阶段 6 共享构建配置、更新、最终包和负载验证见 [交付指南](DESKTOP_DELIVERY.md)。没有更新源时保持可手动安装的测试包，真实签名更新另验。`npm run desktop:stress` 默认 60 秒，可追加 `--duration=<毫秒>`；结果仍是合成压力证据。
