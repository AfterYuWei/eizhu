# 0.5.0 公开发布证据

2026-10-21 14:00:52（Asia/Shanghai）正式公开 [eizhu 0.5.0](https://github.com/AfterYuWei/eizhu/releases/tag/v0.5.0)，不是草稿或预发布。用户已明确授权合并、推送、发布及清理其他分支。

- 安装包及 `v0.5.0` 标签实际来源：`1350ddd9e4a9b304c3fcd127329634cb14362ab3`。
- [四目标完整构建与最终包验证](https://github.com/AfterYuWei/eizhu/actions/runs/39550429348)：四个 package 任务全部成功；原发布步骤因 Linux 架构文件名校验失败。
- [最终发布任务](https://github.com/AfterYuWei/eizhu/actions/runs/39552712986)：成功。发布工具位于 `1dfc64b8d3f6e51eaee0d2e29821b0afe69f5598`，复核四目标成功记录、来源祖先关系、标签、版本及当前应用源码指纹后复用已验证产物。
- 四目标源码指纹均为 `13b96af28692434fe3011c9cc55dfd2571688ffa5f709b4b48f37fd6c5de82d7`。后续发布工具修正不改变应用构建输入，未重复声明原生验收。

| 目标 / runner | 最终包执行 | 60 秒合成负载 | 阶段 4 OpenSSH SFTP 集成 |
|---|---|---|---|
| Windows x64 / windows-2022 | NSIS 隔离安装、启动、卸载通过 | 60.090 秒通过 | 缺少 sftp-server，明确待验 |
| macOS x64 / macos-15-intel | DMG 只读挂载、临时复制启动通过 | 60.107 秒通过 | 通过 |
| macOS arm64 / macos-15 | DMG 只读挂载、临时复制启动通过 | 60.054 秒通过 | 通过 |
| Linux x64 / ubuntu-22.04 | AppImage 解包、X11/Xvfb 启动通过 | 60.067 秒通过 | 通过 |

安装包来源的回归：macOS/Linux 为 282 项通过；Windows 为 281 项通过、1 项符号链接测试跳过。发布工具修正后的本机完整回归为 283 项通过。负载是 20 个合成 SSH 会话、4 个活跃终端和每批 5 个本地任务；IPC P95 不等于可见交互 P95，不替代真实网络混合负载或 8 小时稳定性。

公开资产共 22 个：8 个安装包、5 个 blockmap、4 份构建信息、4 份实际烟测 JSON 和 SHA256SUMS.txt。此目录的 9 份小型原始资产均从公开 Release 下载并核对 SHA-256；清单中 21 个资产摘要与 GitHub 返回的服务端摘要全部一致。未在本机重新下载大型安装包；其字节摘要由发布任务流式计算，并与 GitHub 上传记录交叉核对。

`release.json` 保存公开资产文件名、字节数、摘要及下载地址；`build-info-*.json` 与 `smoke-*.json` 保留实际原始结果；`SHA256SUMS.txt` 是公开校验清单，`release.png` 为公开页面截图。

本版本未签名，macOS 未公证；四目标均未配置独立更新源，首个 Electron 版本手动安装。Linux deb/rpm 系统安装、Wayland、系统密钥库、真实外部服务、人工原生交互、真实签名升级及完整性能门禁继续待验，详见 [发布清单](../../../RELEASE_CHECKLIST.md)。官方账号、同步与官方备份继续延期。阶段 6 的原始本机候选报告保持历史事实，不由本次四目标结果倒填。
