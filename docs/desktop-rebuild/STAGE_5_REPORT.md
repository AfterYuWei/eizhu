# 阶段 5：本地完整版本与第三方云备份

记录日期：2026-10-21。用户已确认阶段 0–4，并授权阶段 5；按本轮指示，**官方账号同步保持待开发，后端服务部署后再接入**。官方登录/注册、账号空间切换、同步 v2、官方完整备份及旧官方快照导入不计为本轮完成项，请求继续返回 `STAGE_NOT_READY`。

基线为 `61c0a4c998c62ceb49c412715e500e67e1086458`（阶段 4），分支 `codex/electron-stage-2`。本交付快照在 Git 提交前生成；后续提交包含此快照。本轮没有推送或发布，保留未跟踪的 `.codex/`；没有修改 VERSION、依赖/锁文件、品牌、固定兼容样本或读取旧数据目录。

当前状态：本轮实现已接通；270 项回归、macOS x64 构建输出及最终 DMG 的完整隔离进程树烟测通过，提交实现、差异和待验边界供用户审查。真实外部云账号及其他目标平台不计为通过。

## 实现与差异

| 范围 | 实现与边界 |
|---|---|
| 契约与调用 | 新增 `archive` 运行时 schema；preload/main/runtime 都校验。仅主窗口可管理备份，使用原 requestId/runtimeId/workspaceId/generation；官方业务未启用 |
| 存储与事务 | `ArchiveRepository` 在现有 SQLite Worker 执行，复用 schema v2 的用途加密状态；版本和设置、目标、凭据、OAuth 令牌及事件持久化；事务不跨消息；快照/修订/密码一次捕获，编码后复核修订和密码 |
| 完整版本 | 现有 eizhu v1 codec、50 MiB、Argon2id/AES-GCM；加密前规范 payload SHA-256 去重；版本号单调递增；密码轮换保留原版本密码；内容不变时不重写版本 |
| 版本管理与恢复 | 本地保留数、未提交版本保护、显式删除本地副本；本地/云端密码解锁、摘要及大小验证、来源和变化预览；确认前安全快照、预览过期及并发变化检查沿用阶段 2 |
| 调度与关闭 | 变更防抖、间隔/每日系统时区调度、自动提交开关；错过的时间合并一次；正常退出先完成编辑器确认，再创建本地版本；忙碌或失败保留窗口；关闭取消网络/监听并等待资源释放 |
| WebDAV / S3 | 独立设备命名空间；WebDAV 集合、Basic 认证；S3 SigV4、endpoint/region/bucket/prefix/path style；目标探测写入/读回/删除；已有索引必须有 ETag，条件写和读回后才能确认 |
| Google Drive / OneDrive | 分别对接 Drive 文件 API、Graph 文件 API；独立设备目录、读取/上传、PKCE S256、临时回环回调、state/Host/路径校验、一次性及超时、加密刷新令牌与单目标刷新串行化；真实厂商账号仍待验 |
| 多目标任务 | 最多三目标并发，每个目标独立确认。上传对象及索引都读回校验；同版本异摘要、索引并发变更、目标修订变化或响应未知均不误确认。结果未知由用户检查后手动提交；不自动重放写操作 |
| 系统网络 | 核心不导入 Electron，内部消息委托 main 的 `net.fetch`，保留系统代理/TLS；禁止自动重定向和 HTTP 缓存；单请求 20 秒和 52 MiB 边界；OneDrive 下载地址不转发 bearer |
| UI 与说明 | 沿用完整备份面板，接通配置、版本、云端目录、恢复预览与目标状态；补充每日时间、自动提交及本地删除确认；账号页/同步页明确后端部署后接入；OAuth 提示改为桌面回环授权 |
| 启动可靠性 | 烟测发现隐藏窗口会暂停首次动画帧；主窗口在 React DOM 提交时发送就绪握手，避免显示窗口与动画帧互相等待；就绪组件独立导出以满足热更新规则，保留烟测渲染诊断 |

核心新增文件位于 `packages/core/src/archive/`、`packages/contracts/src/archive.ts`、`apps/desktop/src/main/cloud-network.ts` 和 `stage5-smoke.ts`。入口就绪组件为 `apps/web/src/components/MainWindowReady.tsx`。完整修改与源摘要见最终交付清单。

## 检查和执行证据

- `npm run check`、`npm run lint`：主进程/核心/契约及前端类型和 lint 通过。
- `npm test`：55 项基础/契约/核心、205 项前端、10 项固定基线，共 **270 项通过**。新增覆盖 AWS 官方 SigV4 向量、WebDAV 条件写/重定向、损坏及外部空间索引、OneDrive 下载令牌隔离、Drive 重复目录、PKCE 回调/state/目标修订、每日/间隔调度。
- `npm run baseline:verify`、`npm run architecture:verify`、`git diff --check`：冻结兼容证据只读、无旧入口、核心无 Electron 依赖、单锁文件及品牌图标核对通过。
- `npm run desktop:build` 与 `npm run desktop:smoke`：在 Electron 主窗口 → preload → main → utilityProcess → 真实 SQLite / 原生 KDF Worker 中执行；合成 WebDAV/S3 服务经过实际 Electron 系统网络桥。覆盖目标探测临时对象清理、去重、各目标独立确认、二次条件写、ETag 412 不误确认、提交成功但响应丢失后手动恢复、云端/本地恢复、旧预览拒绝、密码轮换、真实变更调度与退出快照屏障。
- 真实终止并重启业务进程后，版本仍从加密 SQLite 恢复。直接读取 SQLite 与 WAL 验证无合成备份密码和目标凭据明文；普通目标列表不返回凭据；官方业务请求均返回 `STAGE_NOT_READY`。OAuth 回调只访问合成本地监听，未访问真实账号。
- `CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:package` 与 `npm run desktop:smoke:package -- artifacts/desktop/stage-5/eizhu-0.4.4-mac-x64.dmg`：从最终 DMG 只读挂载后提取执行同套完整烟测。实际提取应用中 **267 个 out 文件与本次构建逐字节一致**，清单见 [包内构建文件](evidence/stage-5/mac-x64-package-files.json)。
- 同套进程烟测继续覆盖阶段 2 固定备份/反例、原生数据库事务与密钥、阶段 3 SSH/终端/隧道、阶段 4 OpenSSH SFTP/传输恢复/安全保存/独立编辑器及本地 Monaco。

早期执行暴露跨 contextBridge 错误断言、Chromium 禁止覆盖 Host、HTTP 缓存干扰条件请求、隐藏窗口动画帧暂停、测试标签激活方式及入口组件热更新规则；提交前核对原始 lint 日志时补正该错误，并重做完整验证。已修正后完成最终构建与 DMG 全量复验。失败运行不计为通过。最终原始日志、摘要和截图见 [证据索引](evidence/stage-5/README.md)。

## 验收矩阵与待验

| 目标 / 能力 | 本轮结果 |
|---|---|
| macOS x64 构建输出 | 完整隔离进程树烟测通过，见 [JSON](evidence/stage-5/mac-x64-build-smoke.json) |
| macOS x64 最终 DMG | 提取后完整烟测通过；未签名/公证，见 [JSON](evidence/stage-5/mac-x64-package-smoke.json) |
| macOS arm64、Windows x64、Linux x64 | 本轮未执行，待验；阶段 1 的结果不替代本轮证据 |
| Google / Microsoft 真实 OAuth 同意、令牌过期、租户策略及文件 API | 已实现客户端；本轮协议替身与回环测试不计为真实账号验收 |
| 真实 WebDAV/S3 厂商、系统代理认证、自签证书、限流/网络切换 | 回环服务执行协议和故障路径；真实外部环境待验 |
| 官方账号 / 同步 / 官方备份 / 旧官方快照 | 按用户要求待开发，后端部署后实施与验收；本轮没有访问真实服务端 |
| 签名、公证、真实更新、压力与长稳 | 阶段 6 待验；不以配置或构建代替执行证据 |

本轮只开放 `prompt` 冲突策略和 `keep_forever` 云保留策略，历史类型中的 `latest` 自动覆盖、`mirror_local` 云镜像删除返回 `UNSUPPORTED_POLICY`，不计为已实现。云端不会自动删除对象；对象提交而索引未确认可能留下孤立对象。单设备目录隔离与条件写不能构成跨外部写入者的全局事务，Google Drive 同名创建仍须检测并拒绝重复。新安装不自动发现旧设备命名空间；其他设备数据可通过交换备份文件导入。调度仅在应用运行时执行，强制杀进程/断电不保证退出快照。

本地版本硬上限 1000（0 保留数仅关闭按数量清理）；未提交版本会受到保护，达到上限要求用户清理。所有密码和令牌均不进普通列表或日志；Buffer 尽力清理，不承诺字符串/GC 清零。

使用说明见 [完整版本与第三方云备份](../BACKUP_CLOUD.md)。本轮完成后提交实现、证据、差异和待验边界供用户审查；阶段 6 尚未开始。

测试产物：`artifacts/desktop/stage-5/eizhu-0.4.4-mac-x64.dmg` 与同目录 ZIP；包内备份页截图见 [实际界面](evidence/stage-5/mac-x64-package-backup.png)。截图是客户端内容，不替代原生窗口按钮及 OS 交互的人工验收。完整源文件、证据和安装产物摘要在 [交付清单](evidence/stage-5/delivery.json)。

回退本轮源码时以基线 `61c0a4c` 和交付清单逐项审查撤销；避免整体重置覆盖后续用户改动。独立测试产物可直接移除，本轮烟测没有接触用户数据目录或真实云目标。
