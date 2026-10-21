# 桌面工程架构

业务进程链路是 React → 受限 preload → Electron main → utilityProcess → 数据库/计算 Worker。
目标架构与后续领域约束见 [架构约束](desktop-rebuild/ARCHITECTURE.md)，阶段状态以交付报告为准。

`apps/web` 保存桌面组件、样式、编辑器未保存内容和临时状态。共享业务 DTO 在 `packages/contracts`；前端类型路径只作重导出。
preload 按领域暴露方法，不暴露底层 IPC；启用方法的输入、输出在共享 schema 中校验。本地、SSH、SFTP/编辑器、第三方云备份已接通；应用更新止于 main，其余预留业务方法一律拒绝。
main 根据实际 WebContents/frame/origin 绑定窗口，校验运行上下文后路由。平台操作止于 main；core 不依赖 Electron。
utilityProcess 拥有离线工作区服务，独立检查运行实例、空间与代次。数据库线程独占 SQLite；有界计算线程执行原生 Argon2 与加密烟测。

设置在创建窗口前由数据库 Worker 加载，渲染端在导入 Zustand 前水化同步缓存，避免跨架构设置迁移和首帧主题变化。
全局 `global.sqlite` 保持 schema v1；离线业务库升级为 schema v2。设备主密钥经 HKDF 分离空间密钥，AES-GCM 的 AAD 绑定实体类型/ID、outbox 修订及快照用途。业务变更、元数据审计和加密 outbox 在一个同步事务提交，后者当前只保存本地变更，官方网络同步按用户要求延期。
数据库 Worker 持有加密实体、本地状态、15 分钟且最多 4 个恢复预览及加密安全快照。计算 Worker 执行备份 KDF/编解码、私钥验证与生成。文件授权只由 main 的原生选择器建立，绑定窗口、运行实例和代次，源文件身份/大小/时间在实际读取时复核。
生产资源使用 `eizhu://app` 本地协议与 CSP；窗口沙箱、上下文隔离、Web 安全均开启，Node 集成关闭，所有 Monaco/font/worker 资源本地交付。

Worker 与资源 Scope 在关闭时幂等释放。业务进程异常退出会拒绝挂起请求，通知渲染端，保留编辑器内存内容；不会重放终端输入或结果未知的写操作。
业务进程使用显式恢复，传输任务重启后由用户手动恢复；账号切换仍待官方后端接入。进程树烟测验证代次失效及数据库重开，但不能代替真实账号隔离验收。

阶段 3 的路由、指纹与 MFA、带消费确认的二进制终端、补全/详情子通道、独立隧道和本地历史见 [SSH 文档](SSH.md)。持久写入仍只通过数据库 Worker。
