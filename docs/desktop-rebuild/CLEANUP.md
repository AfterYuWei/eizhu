# 代码与文档清理审计

本轮以阶段 5 提交 `8334c5fe9e8a45ff314b6fdab2fc684d1a7b7088` 为基线。执行范围限公共桌面工作区；没有读取 `admin/`、用户数据库或签名材料，未恢复已删除的 CLAUDE.md/CODEBUDDY.md；未跟踪 `.codex/` 保留。

| 范围 | 结果/处理 |
|---|---|
| 自有运行时 | 只保留 Electron/React/TypeScript；原生依赖按 Electron ABI 分发 |
| 旧目录/移动入口 | 架构检查确认 src-tauri、旧 web、VERSION_MOBILE 不存在，源文件无 Rust/Swift 运行时、移动命名入口或旧桥导入 |
| 依赖/锁文件 | 单根锁文件，无旧容器插件；本轮依赖和锁文件未变 |
| 进程边界 | 渲染端无 Node/core/SQLite/SSH 导入，core 无 Electron 导入；更新属于 main，未开放通用 IPC |
| 构建/CI | 共享版本/通道/更新源配置、打包前匹配构建记录；移除 ESLint 无效旧目录排除项，审计所有现役工作流与脚本入口 |
| 文档 | 重写旧 CI 说明，校准 README/AGENTS/架构/开发/补全/发布及阶段状态；新增最终矩阵、发布清单、性能与本轮报告 |
| 未引用脚手架 | 删除无引用的 React/Vite 标志资源；产品图标、字体和品牌资源保持原样 |
| 历史证据 | 阶段 0–5 报告、固定 Git revision、备份向量和历史截图保留；其中旧技术词是兼容取证，不是可运行入口 |
| 静态设计参考 | docs 中的 HTML 原型保留为设计参考，不进入安装包或应用资源协议 |
| 未开放能力 | 官方账号/同步/官方备份维持 STAGE_NOT_READY，完整类型定义不计为实现 |

可重复检查：`npm run architecture:verify`、`npm run baseline:verify`。前者同时审计现役 CI 中的退役构建命令；后者从冻结 Git 源和固定字节复核兼容样本。产物与源码/构建输出摘要由 `desktop:delivery:verify` 记录，安装包仍须另做进程树烟测。

本轮没有改 VERSION、应用标识、固定样本或品牌图标，也没有自动发布、推送分支或部署更新源。
