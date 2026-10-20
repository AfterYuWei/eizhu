# 桌面工程架构

阶段 1 实现的链路是 React → 受限 preload → Electron main → utilityProcess → 数据库/计算 Worker。
目标架构与后续领域约束见 [架构约束](desktop-rebuild/ARCHITECTURE.md)，阶段状态以交付报告为准。

`apps/web` 保存桌面组件、样式、编辑器未保存内容和临时状态。共享业务 DTO 在 `packages/contracts`；前端类型路径只作重导出。
preload 按领域暴露方法，不暴露底层 IPC；启用方法的输入、输出在共享 schema 中校验。预留业务方法当前一律拒绝，不进入数据库。
main 根据实际 WebContents/frame/origin 绑定窗口，校验运行上下文后路由。平台操作止于 main；core 不依赖 Electron。
utilityProcess 拥有离线工作区服务，独立检查运行实例、空间与代次。数据库线程独占 SQLite；有界计算线程执行原生 Argon2 与加密烟测。

设置在创建窗口前由数据库 Worker 加载，渲染端在导入 Zustand 前水化同步缓存，避免跨架构设置迁移和首帧主题变化。
全局 `global.sqlite` 与 `workspaces/offline/workspace.sqlite` 各从 schema v1 创建；领域表、事务仓储与加密 outbox 在阶段 2 补齐。
生产资源使用 `eizhu://app` 本地协议与 CSP；窗口沙箱、上下文隔离、Web 安全均开启，Node 集成关闭，所有 Monaco/font/worker 资源本地交付。

Worker 与资源 Scope 在关闭时幂等释放。业务进程异常退出会拒绝挂起请求，通知渲染端，保留编辑器内存内容；不会重放终端输入或结果未知的写操作。
进程自动恢复、账号切换和持久任务恢复仍需随所属业务阶段完成并验证，不能把基础进程启动视为业务恢复完成。
