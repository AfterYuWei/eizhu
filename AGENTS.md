# eizhu 桌面仓库规范

eizhu 使用 Electron + React + TypeScript/Node.js，只维护 Windows x64、macOS arm64/x64、Linux x64。
UI 与文档使用中文。当前执行阶段 6 最终工程交付与发布验收；阶段 5 本地完整版本与第三方云备份已交付。账号前三批已提交，第四批双目录验收工具已通过合成流程；真实账号、邮件与部署验收待专用测试邮箱。备份服务于离线与第三方，本轮不接入官方备份。阶段 6 完成发布验收。
用户已确认阶段 0–4，阶段 5 已提交，并明确授权完成阶段 6 及独立账号条目同步对接。每阶段提交可审查结果、测试证据和差异清单，经用户确认后进入下一阶段。
用户追加授权：第三批完成并验证后自动进入第四批真实服务与双端验收，无需再次等待逐批确认；不包含推送或发布授权。
不将未实现、仅有类型定义或未在目标平台执行的能力标为通过。状态见 `docs/desktop-rebuild/`。

## 开发入口

Node 24 LTS（至少 24.7）、npm workspaces、一个根锁文件。用户安装应用无需另装 Node。

```bash
npm ci                     # 安装并重建 Electron 原生模块
npm run desktop:dev         # Electron + React；仅渲染预览无法执行桌面业务
npm run check
npm run lint
npm test
npm run baseline:verify     # 只读校验固定旧备份/协议/UI 证据，不能刷新样本
npm run desktop:build
npm run desktop:package     # 当前平台最终安装产物
npm run desktop:smoke       # 构建输出进程树烟测，使用临时数据目录
npm run desktop:smoke:package -- <安装包路径>
npm run desktop:accept:sync -- --synthetic # 两个隔离目录验证认证与同步；真实模式见第四批报告
```

原生模块按 Electron ABI 编译。修改原生依赖或 Electron 后执行 `npm run native:rebuild`，并重新验证最终产物。
数据库集成与 KDF 在 Electron 业务进程/Worker 烟测中执行；不要用 Node 能加载原生模块替代 Electron 验证。

## 模块与进程边界

- `apps/web`：沿用桌面 React 组件、样式与交互，Zustand 仅持有临时状态和已水化的 UI 偏好。
- `apps/desktop/src/preload`：沙箱内的受限 `window.eizhu` 领域方法。禁止暴露 ipcRenderer、通用 invoke、SQL、任意执行、fs 或 Node 全局。
- `apps/desktop/src/main`：窗口/关闭协调、系统权限与原生能力、设备密钥保护、业务进程监督、应用资源协议。
- `apps/desktop/src/runtime`：一个 utilityProcess 装配入口。
- `packages/core`：不导入 Electron。领域用例、仓储、连接与任务管理归所属业务；不要求所有领域使用相同目录模板。
- `packages/core/src/database`：数据库 Worker 唯一拥有 SQLite 连接。全局 schema v2 保存加密账号会话；业务 schema v3 保留加密实体、本地设置、审计、outbox、恢复预览及安全快照，并增加同步基础表。升级前生成一致性副本；刷新轮换与账号切换只通过数据库 Worker 持久化。
- `packages/core/src/workers`：有界队列与独立计算线程。禁止在终端事件循环执行 KDF、密钥生成或全量备份处理。
- `packages/contracts`：唯一 DTO、编译期接口、启用方法的运行时 schema、错误、事件和空间上下文定义。

先为业务方法补齐输入/输出/事件 schema，再在 main 与 runtime 启用；预留的领域类型不是业务实现。
官方备份及其他尚未开放的业务请求必须返回 `STAGE_NOT_READY`，禁止用空数组或假成功冒充已实现的云备份能力；账号和条目同步已启用的方法必须执行真实业务。首次预览确认前不得上传；远端应用与游标推进同事务且不生成回声 outbox；未知结果只能恢复被冻结的同一请求。

## IPC、所有权与事务

主进程验证窗口身份、顶层 frame、可信 origin、权限和资源归属；不要相信渲染端声明的账号或路径。
请求/响应/事件绑定 requestId、runtimeId、workspaceId、generation。业务进程独立检查上下文；旧空间和旧进程响应必须失效。
控制面异步 RPC；终端使用授权后的二进制 MessagePort、消费确认及有界重放。文件保持流式、有限分块与背压。
不提供业务用本地 HTTP/WebSocket 网关。

持久写入只进入数据库 Worker。后续业务变更、审计与加密 outbox 在同一同步 SQLite 事务提交，不跨消息持有事务。
本地提交不依赖网络成功；请求结果未知时不自动重放写操作。同步使用被冻结的幂等请求恢复。
连接、会话、隧道、订阅、任务和 Worker 有明确所有者，关闭必须幂等、等待实际释放，不依赖 React 卸载。
关闭及空间切换先完成所有编辑器未保存确认，再停止旧空间任务、释放资源并切换代次。

## 数据、安全与兼容

系统用户数据根下 `eizhu-desktop`；开发版独立 `eizhu-desktop-dev`。不寻找、读取或迁移旧数据库、key、设置、任务。
Chromium 存储也使用新目录。全局 UI 设置与账号元数据、各空间业务库分开。
设备密钥优先使用系统密钥库；Linux `basic_text` 不能视为安全密钥库。仅首次初始化允许受限文件兜底。
已有密钥无法解锁、损坏或丢失时必须保留数据并报错，不允许静默生成替代密钥。
不将凭据、私钥、令牌或密钥写入日志、普通列表、持久前端状态。敏感 Buffer 尽快清理，不承诺 JavaScript 字符串/GC 可靠清零。
窗口保持 sandbox/contextIsolation/webSecurity 开启，nodeIntegration 关闭。仅加载本地资源，禁止放开远程脚本来修复编辑器问题。

备份是独立交换格式：继续导出 `.eizhubackup` v1，兼容 `.eizhubackup`/`.xcbackup` 三种凭据模式；云端协议独立验收。
固定证据在 `tests/fixtures/desktop-baseline`，禁止在普通测试/CI 重写；历史实现从 manifest 的 Git revision 只读取证。
旧备份不包含 UI 设置、命令历史、未完成传输和云目标配置。具体字节契约见兼容说明。

## UI 与验收门禁

遵循 `DESIGN.md` 的桌面尺寸、语义颜色、圆角、动效、中文文案、键盘及无障碍约束。
优先 shadcn/ui、`cn()`、共享 token；图标通过 `apps/web/src/lib/{serverIcons,groupIcons,vaultIcons}.tsx` 注册。
保留桌面 Pointer Events、响应式布局及可访问性；不得重新加入移动页面、软键盘生命周期或移动构建入口。
每次交付执行相关类型、lint、回归、固定格式兼容检查。进程/原生模块变更需最终安装产物烟测。
四目标矩阵与签名配置见发布文档。未执行的平台、证书/公证、真实更新及性能实测必须明确列为待验，不能用 CI 配置替代执行证据。

`VERSION` 是唯一版本源；保留品牌、图标、应用标识、stable/test。首个 Electron 版本手动安装，使用独立更新源。
`admin/` 是独立闭源仓库，不读取、复制或加入公共仓库；`data/` 和用户签名材料不属于源码。
不恢复用户已删除的 `CLAUDE.md` / `CODEBUDDY.md`。
