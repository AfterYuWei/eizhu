# Electron 软件更新

2026-10-21 用户确认测试版和正式版均使用 GitHub Releases，测试版同时发布预览版本。本次适配保留 VERSION、stable/test 及既有安装包命名，不接入官方账号服务。

| 通道 | 发布入口 | 元数据 | 客户端选择 |
|---|---|---|---|
| stable | main 四目标验收后的正式 Release | latest.yml、latest-mac.yml、latest-linux.yml | 最新正式 Release，不接受预览版本 |
| test | dev 的 Windows x64、macOS Intel x64 验收后的预览 Release | test.yml、test-mac.yml | Windows x64、macOS Intel x64 显式选择 test 通道，只选择 test 预览标签 |

2026-10-22 起，正式环境仍构建四目标，测试环境构建 Windows x64 和 macOS Intel（x64）。默认仓库为 `AfterYuWei/eizhu`。预览版本使用 `v<VERSION>-test.<Git提交计数>.<短SHA>`，发布设置为预览且不占用正式最新版。两类发布均先验证所需目标的版本、提交、源码指纹、最终安装包烟测及 60 秒负载报告；草稿上传完整资产后再公开，不覆盖既有资产。测试发布校验 Windows x64 与 macOS x64，其他平台不生成空更新元数据，也不提供新的测试安装包。

发布准备工具从实际复制的安装包字节计算 SHA-512 和文件大小，生成符合 electron-updater 的 YAML 元数据（采用 YAML 兼容的 JSON 语法），元数据一并计入 SHA256SUMS.txt。正式版 macOS 的单个元数据文件同时包含 x64/arm64 的 ZIP 与 DMG，测试版仅包含 x64；Windows 的两个通道均包含 NSIS EXE，Linux 正式版包含 AppImage。deb/rpm 继续提供手动安装。

主进程显式设置更新通道，每次设置后关闭 electron-updater 隐式启用的降级许可。正式版也可主动选择测试通道；回到正式通道时仅接受版本更高的正式版本，不自动降级。下载、摘要校验和安装始终使用用户已看到的候选，检查失败或下载失败会废弃旧候选，安装前仍执行未保存编辑器确认。

“关于”页保留通道选择，显示检查结果、错误、下载百分比与安装阶段；失败后可重试。两类通道都提供 GitHub 版本页面入口。不支持应用内更新的开发运行及 deb/rpm 安装方式显示手动安装提示。

`EIZHU_UPDATE_STABLE_URL`、`EIZHU_UPDATE_TEST_URL` 可分别覆盖通道，继续按 `/electron/<通道>/<平台-架构>/latest*.yml` 读取；覆盖源需要单独部署。更新服务不使用旧框架的更新协议。

已有 0.5.0 及本轮之前的测试安装包无法通过修改仓库获得新客户端配置；需手动安装首个包含本次适配的版本。本轮本地验收时改动尚未推送或发布，不修改已公开的 0.5.0 资产。Windows 签名、macOS Developer ID/公证和真实 A→B 升级仍待验，自动化与本机烟测不能代替这些验收。

2026-10-21 更新适配时的本机验证结果（macOS x64，Electron 44.9.0；下表保留当时四目标策略的历史证据）：

| 检查 | 结果及证据 |
|---|---|
| 类型、lint | npm run check、npm run lint 通过 |
| 完整回归 | 296 项通过：基础 71、前端 215、固定兼容 10；其中更新专项 26 项 |
| 固定证据、架构 | baseline:verify、architecture:verify 通过，未修改冻结样本 |
| GitHub 渠道 | 实际 GitHubProvider 配合隔离 HTTP 响应验证 test/latest 选择；未连接真实公开更新源 |
| 发布元数据 | stable/test 三平台元数据由实际 updater 解析；安装文件 SHA-512、大小、macOS 双架构及完整四目标门禁通过合成产物回归 |
| 本机构建与打包 | desktop:build、desktop:package 通过；包内 app-update.yml 为 GitHub/test；本机包未签名 |
| 构建烟测 | [原始报告](evidence/update-adaptation/mac-x64-build-smoke.json)，包含真实下载器的错误 SHA-512 拒绝 |
| 最终 DMG 烟测 | [原始报告](evidence/update-adaptation/mac-x64-package-smoke.json)，隔离数据根、数据库/Worker、更新及重启恢复通过；合成负载 3 秒，不作为性能验收 |
| 交付一致性 | [摘要与包内容核对](evidence/update-adaptation/delivery-summary.json)；[构建来源](evidence/update-adaptation/build-info.json)记录未提交源码指纹 |
| 页面 | [最终包截图](evidence/update-adaptation/mac-x64-package-update.png)；烟测隔离更新来源，因此显示手动更新状态 |
| 待执行 | Windows x64、macOS arm64、Linux x64 本轮最终包；真实 GitHub 预览/正式发布与签名 A→B 升级 |

首次沙箱回归的 OAuth 回环监听及 DMG 创建被系统权限阻止，获准在沙箱外重跑后通过。本轮本地验收仅完成发布工作流 YAML 解析与发布准备工具回归，未触发远端工作流；后续推送的执行结果以对应 GitHub Actions 为准。
