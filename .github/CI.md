# Electron CI 与候选包

仓库只维护 Windows x64、macOS x64/arm64、Linux x64。版本源是根目录 `VERSION`，依赖以根 `package-lock.json` 为准；Node 24 LTS。

| 工作流 | 入口 | 实际操作 |
|---|---|---|
| `quality.yml` / `quality-core.yml` | PR、dev/main 推送 | 类型、lint、回归、架构、固定兼容基线及构建 |
| `build-desktop.yml` | 当前阶段分支推送、手动、复用调用 | 四目标原生构建、打包、最终包烟测及 60 秒合成负载 |
| `build-desktop-test.yml` | 手动 | test 候选安装包 |
| `build-desktop-stable.yml` | 手动 | stable 候选安装包 |

这些工作流只上传 Actions artifacts，`publish: never`；不创建 GitHub Release、不部署更新源。正式发布需要完成 [发布清单](../docs/RELEASE_CHECKLIST.md) 并获用户授权。
`VERSION=x.y.z` 时 stable 为 `x.y.z`，test 为 `x.y.z-test.<Git提交计数>.<短SHA>`。同一提交、通道和架构必须重新构建后再打包；构建记录与打包配置不一致会拒绝。

可选 Variables：`EIZHU_UPDATE_STABLE_URL`、`EIZHU_UPDATE_TEST_URL`，分别以 `/electron/stable/`、`/electron/test/` 结尾，必须是无凭据的 HTTPS URL。每个目标再追加 `win32-x64/`、`darwin-x64/`、`darwin-arm64/` 或 `linux-x64/`。缺省时只产出手动安装包，更新入口不会报“已是最新”。官方账号服务仍待开发，构建不依赖账号服务地址。

默认 `validation=full`，执行全部回归。仅烟测工具变化、已有对应回归证据且业务/存储/兼容实现未变时，才允许 `package-only` 或提交标题 `[package-only]`；跳过的回归必须引用原证据，不能记为本轮通过。类型、lint、基线、架构、构建、打包和最终包启动仍执行。

矩阵使用 windows-2022、macos-15-intel、macos-15、ubuntu-22.04；Linux 配置 Clang 15、Xvfb 和打包依赖。每个目标独立 `npm ci`、重建本机 Electron ABI，禁止跨目标复用原生模块。
NSIS 执行隔离安装/卸载；DMG 只读挂载后复制运行；AppImage 解包后在 X11 启动。deb/rpm 的系统安装、Wayland、真实系统密钥库仍需专门验收。

当前 CI 为未签名测试候选配置（`CSC_IDENTITY_AUTO_DISCOVERY=false`）。不要把已归档的阶段 1 四目标结果当作阶段 6 结果。实际状态与证据见 [阶段 6 报告](../docs/desktop-rebuild/STAGE_6_REPORT.md)。
