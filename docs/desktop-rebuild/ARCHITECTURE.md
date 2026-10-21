# 全新桌面架构约束

状态：目标设计已确认，阶段 1 已验收，阶段 2 已接通本地领域、加密存储与文件备份；阶段 3 已接通 SSH/终端/隧道/详情；阶段 4 已接通 SFTP、传输恢复与独立编辑器安全保存；阶段 5 已接通独立完整版本、自动备份和第三方云目标。官方账号、同步及官方备份按用户要求延后至后端部署后接入，阶段 6 已接通独立更新客户端和交付工具；真实签名发布仍需门禁。当前证据见 [阶段 6 报告](STAGE_6_REPORT.md)。

## 工程和依赖

```text
apps/desktop       Electron main、preload、utilityProcess入口及平台适配
apps/web           现有React桌面组件、样式、交互和临时状态
packages/core      领域服务、领域仓储、SSH/SFTP、同步、备份和任务管理
packages/contracts DTO、命令/事件类型、运行时校验和错误契约
```

npm workspaces与单一锁文件。以Node 24 LTS作为开发环境；运行时由Electron自带Node，不要求用户安装Node。
初始选型为受支持的Electron 44.x补丁、electron-vite、electron-builder/updater、ssh2、better-sqlite3、argon2和Node crypto；四目标产物加载与烟测通过后锁定组合。框架主版本升级重新经过同一门禁。

业务模块按用途组织，不为目录对称制造空层。领域只依赖自己的模型、用例、仓储/协议端口及必要的共享契约。
第三方SSH类型限制在SSH适配器，SQLite访问限制在领域仓储及数据库Worker；core不导入Electron。

## 进程和所有权

- React承载页面、xterm、Monaco、Zustand临时状态和编辑器未保存内容，不持有数据库/网络连接/长期凭据。
- preload仅提供window.eizhu下按领域划分的方法和订阅，不暴露原始ipcRenderer、通用invoke、SQL或任意执行能力。
- main是桌面装配根：窗口、单实例、显示时机、关闭确认、系统文件/剪贴板/拖放/外链/深链、系统密钥库和更新。
- 一个utilityProcess负责领域服务、SSH/SFTP、隧道、任务与调度器；按工作区建立显式资源Scope。
- 一个数据库Worker起步，拥有全局和工作区数据库连接。领域仓储在该线程执行完整事务，不跨消息或异步回调持有未完成事务。
- 一个有界计算Worker起步，负责KDF、密钥生成、备份序列化等耗时工作；队列限制与取消必须可测试，禁止无限并发KDF。

session、连接链、隧道、SFTP句柄、传输、订阅、调度器和Worker任务有明确所有者，统一支持取消、等待完成和幂等dispose。
SSH、SFTP和隧道共享路由构造/认证策略，不为了复用代码强行共享彼此的连接生命周期。

## 契约和数据流

命令和事件类型由contracts统一提供编译期类型与运行时校验。尽量复用现有业务DTO，剥离Tauri Channel和移动端能力分支。
原备份/云端字段及序列化由独立codec处理，不为了内部命名习惯改变交换格式。

控制请求带requestId以及runtimeId/workspaceId/generation上下文；窗口和资源权限由main绑定，不能信任React自行声明账号或资源归属。
utilityProcess再次核对工作区和资源。响应/事件带同一上下文，空间切换或进程重启后旧结果无效。
错误通过可序列化的code/message/retryable/details及必要的session/stage/references字段返回，不直接跨进程传递原始第三方Error。

```text
页面操作 → preload类型化方法 → main校验/路由 → 领域用例
→ 数据库Worker完整事务（业务写入 + 审计 + 加密outbox）
→ 本地成功响应 → 独立同步调度 → 绑定空间/代次的状态事件
```

提交成功与同步成功独立。结果未知的写请求不能因RPC断开而自动重发；同步使用原冻结幂等请求恢复。
终端输出使用授权后的二进制MessagePort，约16ms/32KiB批处理，消费确认后补充额度，重放缓存以1MiB起步并有界。
文件优先在Node内直接流式读写，浏览器File输入保持有界二进制分块和背压；不经Base64或全文件数组中转。
业务不建立本机HTTP/WebSocket网关。任何会话输入都不在重连或服务重启后自动重放。

窗口统一启用contextIsolation/sandbox/webSecurity，禁用nodeIntegration；生产只加载本地应用资源协议。
导航和新窗口请求由main约束，外部http(s)链接交给系统浏览器；OAuth的eizhu深链只作已校验的回调输入。
CSP限制脚本/worker/字体来源，Monaco采用本地模块与worker，不通过放开远程脚本或关闭隔离来兼容旧加载方式。

## 新存储与安全

安装版使用系统用户数据根下eizhu-desktop，开发版使用独立目录；在Electron初始化存储会话之前确定userData路径。
全局设置/登录元数据与各工作区业务数据分开；工作区标识包含账号服务器身份和稳定用户ID，布局几何可跨空间保留。
新schema从v1建立，只维护新架构后续升级；不查找旧应用数据库、key、Chromium设置或任务。

设备主密钥优先由系统密钥库保护。首次初始化遇到无安全密钥库时允许受限文件：Unix私有目录/0600文件，Windows使用当前用户ACL。
Linux basic_text不能当作安全密钥库。已有密钥解锁或解密失败必须报错并保留数据，不能转为文件兜底或生成替代密钥。

凭据、代理密码、令牌、同步/备份密钥、历史及持久任务由所属存储策略加密，不进入日志或普通列表。
只有查看/复制等显式操作返回必要敏感数据；剪贴板30秒条件清理保持原行为。Buffer及时清理并缩短生命周期，但不声称JavaScript字符串/GC具有Rust析构清零保证。

设置持久化由Node负责。首帧前完成主题/字号等必要水化，主窗口与编辑器保持一致。Monaco、worker、字体与图标本地交付。

## 故障和退出

空间切换先协调全部脏标签，再阻止新任务、取消并等待旧Scope、释放连接/监听，最后切换并广播新代次。
关闭、窗口未就绪时请求排队、重复确认与取消全部经main协调，不能依赖React卸载来释放后台资源。

业务进程异常退出时，main结束挂起请求，标记连接失效，编辑器继续保留未保存内容。
服务重新拉起只重建服务和持久状态；SSH与传输按既定手动/重试策略恢复，不能伪装成未中断或重放命令。
文件仍采用暂存、校验和最终提交；没有安全替换能力时保留原文件并走原另存入口。

## 发布和文档

保持eizhu品牌、应用标识、VERSION与stable/test；首个Electron版本手动安装，通过备份或正常云端初始化取得业务数据。
独立Electron更新源固定当前展示候选及校验结果，安装前完成现有关闭协调。缺签名/公证时提供测试包并标注真实更新待验收。
开发入口、AGENTS、README、DESIGN、架构/安全/开发/同步/备份/SFTP/发布/CI说明随实际阶段重写，不维护长期双栈或旧运行时桥接。
功能保留、移动端删除、旧内部迁移删除和外部协议兼容以 [功能基线](FEATURE_BASELINE.md) 与 [兼容契约](COMPATIBILITY.md) 分别验收。

阶段 5 的 ArchiveService 管理版本任务、调度及第三方目标。ArchiveRepository 只在现有数据库 Worker 内运行，复用 schema v2 的加密状态表；备份 codec/KDF 仍在计算 Worker。Electron main 通过内部带上下文的消息承载系统网络请求，渲染端只拥有已注册备份领域方法。OAuth 的临时回环 HTTP 监听只接收 state/PKCE 绑定的授权码，不提供业务网关。
