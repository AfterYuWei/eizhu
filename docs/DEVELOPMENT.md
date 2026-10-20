# 开发指南

使用 Node 24 LTS、npm 和平台原生编译工具；Electron 运行时随安装包分发。执行一次根目录 `npm ci`，不要为子工作区生成锁文件。
Windows 使用受支持的 Visual Studio C++ 工具，macOS 使用 Xcode Command Line Tools，Linux 需要 Clang/Clang++、Python、GTK/NSS、密钥库运行库及打包工具。Linux 原生重建与打包统一默认 Clang，显式 CC/CXX 配置继续生效。
Electron 44 的 npm 包提供显式安装器；根 postinstall 会先运行官方安装器并校验分发包，再按 Electron ABI 重建原生模块，不能以 npm 依赖目录存在推断桌面运行时已安装。
`npm run desktop:dev` 启动 electron-vite 和桌面应用。开发目录为系统应用数据根下 `eizhu-desktop-dev`，安装版为 `eizhu-desktop`，两者均不读取旧目录。

`npm run check` 检查全工作区类型，`npm run lint` 检查 TypeScript 与前端规范，`npm test` 运行基础设施、桌面 UI/适配器和固定兼容回归。
`npm run baseline:verify` 从冻结 Git revision 取证；CI checkout 必须保留该提交历史。固定样本不是当前数据库，也不允许普通验证刷新。

Electron 或原生依赖变化后执行 `npm run native:rebuild`。Node 和 Electron 的原生 ABI 不可互相替代；数据库与原生 KDF 必须在 Electron 进程树中烟测。
`npm run desktop:build` 输出 `apps/desktop/out`，`npm run desktop:package` 输出 `artifacts/desktop`。
`npm run desktop:smoke` 使用隔离临时目录验证构建输出；最终产物用 `npm run desktop:smoke:package -- <安装包>`。
烟测 JSON 保存在 `artifacts/smoke/<platform>-<arch>.json`，截图保存在同名子目录；CI 一并归档。不能使用早于当前源码的报告作为最终验证。
Linux GUI 烟测需要 X11 显示环境，可使用 `xvfb-run`，不得通过关闭窗口沙箱来绕过配置错误。

当前只开放阶段 1 基础能力。领域实现时先定义运行时 schema 和归属规则，再接通仓储/协议适配，最后启用 preload 方法。
不增加通用 command 兼容层，不编写旧数据库迁移，不让测试替身进入正式启动路径。
各阶段需提交截图/交互差异、测试结果、平台未验证项，经用户确认后继续。
