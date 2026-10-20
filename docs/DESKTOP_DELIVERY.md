# 桌面构建、发布与 CI

根目录 VERSION 是唯一版本源，Electron main/React/安装包读取同一版本。
支持 Windows x64 NSIS；macOS 13+ arm64/x64 分架构 DMG/ZIP；Linux x64 AppImage、deb、rpm。
Linux 验收基线是 Ubuntu 22.04/24.04、Debian 12、受支持 Fedora；Windows 基线为 10/11，macOS 包需验证原生按钮/全屏。

`npm run desktop:build` 后执行 `npm run desktop:package -- --platform=darwin --arch=x64` 等目标命令。
`.github/workflows/build-desktop.yml` 提供四目标原生构建、最终安装产物取出/安装、进程树烟测及证据归档。
DMG/NSIS/AppImage 的最终内容需实际启动；deb/rpm 额外安装验证、X11/Wayland、缩放/路径及系统密钥库仍需平台实测。
配置 CI 不代表远端执行通过；每阶段报告分别记录本机结果、远端结果及待验项。
手动工作流默认 `validation=full`。只有修改烟测工具、对应回归已有通过证据且业务/存储/兼容代码未改变时，才使用 `package-only`：保留安装、类型检查、构建、打包及最终包烟测，跳过未受影响的基础与固定样本回归。阶段分支尚未合入默认分支、GitHub 不提供手动运行入口时，推送提交可用 `[package-only]` 标记选择同一范围。每次调用记录所复用的测试提交，不能把跳过项记作本轮通过。

stable/test 在构建时选择，阶段 1 只生成测试安装产物，不发布 Release，也不连接旧更新源。
首个 Electron 版本手动安装。electron-updater 依赖已选择，独立更新源、展示候选固定、下载校验/进度、关闭协调和真实更新在阶段 6 实现。
应用不会把未实现的更新检查显示为“已是最新”。

macOS 使用 hardenedRuntime 和 JIT entitlement，保持应用标识 `com.yuweinfo.eizhu`；签名/公证需要独立证书环境。
没有证书时只能验收未签名测试包；macOS 自动更新必须有有效应用签名。Windows 证书、macOS 公证及真实升级需单独报告。
本地烟测命令见开发指南；输出在 `artifacts/smoke`，不提交用户数据、证书或私钥。
