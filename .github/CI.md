# Electron CI 与发布

仓库只维护 Windows x64、macOS x64/arm64、Linux x64。版本源是根目录 `VERSION`，依赖以根 `package-lock.json` 为准；Node 24 LTS。

| 工作流 | 入口 | 实际操作 |
|---|---|---|
| `quality.yml` / `quality-core.yml` | PR、dev/main 推送 | 类型、lint、回归、架构、固定兼容基线及构建 |
| `build-desktop.yml` | 手动、复用调用 | 四目标原生构建、打包、最终包烟测及 60 秒合成负载 |
| `build-desktop-test.yml` | dev 推送、手动 | test 四目标验证；dev 上发布 GitHub 预览版本 |
| `build-desktop-stable.yml` | main 推送、main 手动 | 四目标 stable 验证完成后创建 GitHub Release |

打包步骤使用 `publish: never`。stable 工作流先拒绝已占用的 `v<VERSION>` 标签，要求对应中文发布说明；四目标全部通过后，独立发布任务核对版本、提交、源码指纹及 60 秒负载报告，创建草稿、上传安装包/实际报告/更新元数据/摘要清单，最后公开 Release。test 工作流在 dev 上完成同样的四目标验证，发布 `v<VERSION>-test.<Git提交计数>.<短SHA>` 预览版本，明确设置 `prerelease=true`、`latest=false`。失败时不公开残缺版本，不覆盖同名资产。签名和人工验收边界继续见 [发布清单](../docs/RELEASE_CHECKLIST.md)。用户已于 2026-10-21 授权发布 0.5.0，并确认 Electron 测试/正式更新均使用 GitHub Releases。

仅发布脚本、发布工作流或文档的修改不自动重复 stable 原生构建。四目标已通过而发布失败时，先通过已授权的 Git 连接将 `v<VERSION>` 标签推送到实际构建来源，再在 main 手动运行 stable 工作流，填写 `validated_run_id` 重试发布；必须来自同仓库 main 的 stable 工作流、四目标任务均成功、来源提交已合入当前 main，并且产物的版本及应用源码指纹与当前源码一致。标签仍指向安装包实际来源提交，发布修正不会冒充重新执行原生验收。Linux 文件架构名遵循打包格式：AppImage/rpm 使用 x86_64，deb 使用 amd64；平台构建身份仍为 linux-x64。

重试时先解引用并核对已有标签，再使用 `--verify-tag` 创建 Release。已有标签不需要 `target_commitish`；为旧提交显式传入该参数可能因工作流文件与默认分支不同触发 GitHub 的 workflows 权限限制，`GITHUB_TOKEN` 无法取得此权限，见 [GitHub Release API](https://docs.github.com/en/rest/releases/releases#create-a-release)。不扩大令牌权限、不移动已有标签或替换发布资产。
`VERSION=x.y.z` 时 stable 为 `x.y.z`，test 为 `x.y.z-test.<Git提交计数>.<短SHA>`。同一提交、通道和架构必须重新构建后再打包；构建记录与打包配置不一致会拒绝。

默认更新源为公开仓库 `AfterYuWei/eizhu` 的 GitHub Releases，客户端无需令牌。正式通道使用 latest 正式发布，测试通道显式选择 test 预览发布；拒绝自动降级。发布工具从最终安装包字节生成 SHA-512、文件大小与平台更新元数据：正式版 `latest.yml` / `latest-mac.yml` / `latest-linux.yml`，测试版为对应的 `test*.yml`。macOS 元数据合并 x64 与 arm64 文件，避免独立构建产生同名文件覆盖；元数据也计入 SHA256SUMS.txt。

可选 Variables `EIZHU_UPDATE_STABLE_URL`、`EIZHU_UPDATE_TEST_URL` 仍可分别覆盖对应通道，要求无凭据 HTTPS 地址并以 `/electron/stable/`、`/electron/test/` 结尾；追加目标目录后读取 `latest*.yml`。配置覆盖时需另行部署独立源，工作流只发布 GitHub Releases。已有 0.5.0 安装包不含本轮适配，需手动安装首个接入版本；真实签名升级仍待验。详见 [更新适配](../docs/desktop-rebuild/UPDATES.md)。官方账号服务仍待开发，构建不依赖账号服务地址。

默认 `validation=full`，执行全部回归。仅烟测工具变化、已有对应回归证据且业务/存储/兼容实现未变时，才允许 `package-only` 或提交标题 `[package-only]`；跳过的回归必须引用原证据，不能记为本轮通过。类型、lint、基线、架构、构建、打包和最终包启动仍执行。

矩阵使用 windows-2022、macos-15-intel、macos-15、ubuntu-22.04；Linux 配置 Clang 15、Xvfb 和打包依赖。每个目标独立 `npm ci`、重建本机 Electron ABI，禁止跨目标复用原生模块。
ssh2 1.17.0 的 Ed25519 公钥前导零编码修正在依赖安装、构建及打包前应用，版本与源码不匹配即拒绝继续；固定样本回归随完整测试执行，详见 [CI 密钥生成修复](../docs/desktop-rebuild/CI_KEYGEN_FIX.md)。
源码通过 `.gitattributes` 统一以 LF 检出，确保四目标源码指纹一致；固定兼容样本与原始烟测日志保留 `-text` 字节边界。
NSIS 执行隔离安装/卸载；DMG 只读挂载后复制运行；AppImage 解包后在 X11 启动。deb/rpm 的系统安装、Wayland、真实系统密钥库仍需专门验收。

当前 CI 为未签名测试候选配置（`CSC_IDENTITY_AUTO_DISCOVERY=false`）。不要把已归档的阶段 1 四目标结果当作阶段 6 结果。实际状态与证据见 [阶段 6 报告](../docs/desktop-rebuild/STAGE_6_REPORT.md)。
