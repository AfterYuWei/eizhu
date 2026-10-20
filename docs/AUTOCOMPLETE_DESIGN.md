# 终端补全设计

现有桌面解析、候选过滤和交互保留在 `apps/web/src/lib/completionEngine.ts`、`apps/web/src/hooks/useCompletion.ts` 及相关测试中。
共享生成器 DTO 位于 `packages/contracts/src/models/completion.ts`。阶段 1 只保留 UI，远端补全随 SSH 在阶段 3 实现。

`window.eizhu.session.complete` 只接受会话、请求 ID、受控 generatorId/params 和可选工作目录，不开放任意 shell 执行。
阶段 3 启用前必须补齐参数/输出运行时 schema、窗口和会话归属、空间/代次与请求对应检查。
远端生成器在所属 SSH 连接上使用短超时、取消、输出上限和只读白名单；工作目录需要严格 quoting。
迟到响应不能覆盖新输入、不同目录或新数据空间的候选。中文输入、粘贴、TUI、Tab/方向键与现有桌面提示语继续按冻结案例验收。
