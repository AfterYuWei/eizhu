# Electron CI 与发布

仓库只维护 Windows x64、macOS x64/arm64、Linux x64。版本源是根目录 `VERSION`，依赖以根 `package-lock.json` 为准；Node 24 LTS。

| 工作流 | 入口 | 实际操作 |
|---|---|---|
| `quality.yml` / `quality-core.yml` | PR、dev/main 推送 | 类型、lint、回归、架构、固定兼容基线及构建 |
| `build-desktop.yml` | 手动、复用调用 | 四目标原生构建、打包、最终包烟测及 60 秒合成负载 |
| `build-desktop-test.yml` | dev 推送、手动 | test 候选安装包，仅上传 Actions artifacts |
| `build-desktop-stable.yml` | main 推送、main 手动 | 四目标 stable 验证完成后创建 GitHub Release |

打包步骤使用 `publish: never`。stable 工作流先拒绝已占用的 `v<VERSION>` 标签，要求对应中文发布说明；四目标全部通过后，独立发布任务核对版本、提交、源码指纹及 60 秒负载报告，创建草稿、上传安装包/实际报告/摘要清单，最后公开 Release。失败时不公开残缺版本，不覆盖同名资产。工作流不部署更新源；签名和人工验收边界继续见 [发布清单](../docs/RELEASE_CHECKLIST.md)。用户已于 2026-10-21 授权发布 0.5.0。

仅发布脚本、发布工作流或文档的修改不自动重复 stable 原生构建。四目标已通过而发布失败时，可在 main 手动运行 stable 工作流，填写 `validated_run_id` 重试发布；必须来自同仓库 main 的 stable 工作流、四目标任务均成功、来源提交已合入当前 main，并且产物的版本及应用源码指纹与当前源码一致。标签仍指向安装包实际来源提交，发布修正不会冒充重新执行原生验收。Linux 文件架构名遵循打包格式：AppImage/rpm 使用 x86_64，deb 使用 amd64；平台构建身份仍为 linux-x64。
`VERSION=x.y.z` 时 stable 为 `x.y.z`，test 为 `x.y.z-test.<Git提交计数>.<短SHA>`。同一提交、通道和架构必须重新构建后再打包；构建记录与打包配置不一致会拒绝。

可选 Variables：`EIZHU_UPDATE_STABLE_URL`、`EIZHU_UPDATE_TEST_URL`，分别以 `/electron/stable/`、`/electron/test/` 结尾，必须是无凭据的 HTTPS URL。每个目标再追加 `win32-x64/`、`darwin-x64/`、`darwin-arm64/` 或 `linux-x64/`。缺省时只产出手动安装包，更新入口不会报“已是最新”。官方账号服务仍待开发，构建不依赖账号服务地址。

默认 `validation=full`，执行全部回归。仅烟测工具变化、已有对应回归证据且业务/存储/兼容实现未变时，才允许 `package-only` 或提交标题 `[package-only]`；跳过的回归必须引用原证据，不能记为本轮通过。类型、lint、基线、架构、构建、打包和最终包启动仍执行。

矩阵使用 windows-2022、macos-15-intel、macos-15、ubuntu-22.04；Linux 配置 Clang 15、Xvfb 和打包依赖。每个目标独立 `npm ci`、重建本机 Electron ABI，禁止跨目标复用原生模块。
源码通过 `.gitattributes` 统一以 LF 检出，确保四目标源码指纹一致；固定兼容样本与原始烟测日志保留 `-text` 字节边界。
NSIS 执行隔离安装/卸载；DMG 只读挂载后复制运行；AppImage 解包后在 X11 启动。deb/rpm 的系统安装、Wayland、真实系统密钥库仍需专门验收。

当前 CI 为未签名测试候选配置（`CSC_IDENTITY_AUTO_DISCOVERY=false`）。不要把已归档的阶段 1 四目标结果当作阶段 6 结果。实际状态与证据见 [阶段 6 报告](../docs/desktop-rebuild/STAGE_6_REPORT.md)。
