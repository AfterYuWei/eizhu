# AI Agent v2 接口与权限契约

桌面与独立官方网关同步升级至 v2。旧桌面 AI 配置与历史按空间一次性清理；旧客户端与 v2 网关不兼容。部署由用户安排，源码与本机证据不代表生产验收。

## 能力目录与桌面接口

`packages/contracts/src/ai-tools.ts` 是工具名称、输入、输出和策略的唯一来源。内置 AI SDK 与 stdio MCP 从同一目录生成工具；业务进程统一校验、审批、执行与持久化。目录版本为 `2`。

| 类别 | 工具 |
|---|---|
| 连接 | `session_info` |
| 终端 | `terminal_read_context`、`terminal_execute`、`terminal_start`、`terminal_poll`、`terminal_stop` |
| 文件 | `file_list`、`file_stat`、`file_read`、`file_write`、`file_edit`、`file_mkdir`、`file_rename`、`file_delete` |
| 输出 | `output_read` |

领域接口见 `packages/contracts/src/ai.ts`，由受限 `window.eizhu.ai` 暴露：

- 配置：`settings/configure/removeProvider/configureCli/setDefault`，以及 `capabilities/discover/test/cliStatus`。
- 对话：`open/history/read/remove`；`open` 明确指定已打开的 `sessionIds`，最多32个。
- 运行：`send`；`scope/backend/permission` 先停止当前运行再调整；`decide` 绑定对话、调用 ID 和权限 revision；`cancel` 等待模型、CLI 与关联任务释放，`stopJob` 提供所属长任务的独立中断。
- 输出：`output` 为 UI 提供作用域内的分页文本；模型使用 `output_read`。

默认确认模式。观察模式仅允许结构化读取，任意 shell 命令与文件修改均禁止；确认模式审批 shell 和修改；自动模式在选择范围内执行。“对话内允许此工具”仅绑定当前对话、工具和实际连接实例。重新连接、调整范围、切换后端或权限后旧授权失效。重复审批不能重复执行；旧窗口、空间或进程响应失效。

工具参数增量只供预览。完整供应商步骤成功且参数验证通过后才形成工具操作。执行前先保存运行检查点；断流不产生有效操作；执行结果未知时暂停，用户核查后通过新的发送显式继续，旧调用不重放。重启使待审批失效、执行中记录变为未知。

## 终端、文件与数据

命令注入现有 SSH PTY，沿用目录、变量、别名和函数，显示原始命令与输出，隐藏内部包装。支持 Bash、Zsh、Fish、常见 sh/ash/dash/BusyBox；不支持 Windows 远端 shell。终端忙、存在未提交输入或不能确认 shell 条件时拒绝派发，保留输入。长任务占用同一终端；停止 Agent 同时中断所有关联任务。中断只发给仍属于该任务的终端。

上下文默认最近80行，最多300行，支持范围读取；来源为终端保留的输出文本，控制序列被清除，不等同于 xterm 渲染屏幕快照。文件工具复用已认证连接的 SFTP 子系统，路径必须为远端绝对路径，文本限128KiB。写入审批展示完整修改前后文本，写前检查 mtime 与内容 hash；冲突要求重新读取，不自动覆盖。删除目录递归处理，审批显示目标路径。

超过12000字符的工具结果以摘要片段和随机输出句柄返回，单句柄最多保留262144字符，超限明确标记截断；对话总存储限8MiB。句柄只能在所属对话读取。模型上下文接近配置预算时生成独立摘要，保留目标、完成操作、未知结果、未决事项与近期记录；原始 UI 记录不被摘要替换。预算按 UTF-8 字节保守估算，并受512KiB请求上限约束。

配置、消息、摘要、原生续接项与工具记录均由数据库 Worker 加密存储于 `agent:v2:*`，不进入同步或备份。首次打开新版空间，仅删除旧 `ai:*`，并在同一事务写入清理标记；后续启动不再清理新版数据。CLI 自身的登录与历史遵循原生存储方式。

## 多供应商与 CLI

内置模型使用 AI SDK Core，支持 OpenAI Responses、Chat Completions、Anthropic Messages。每个供应商独立配置协议、地址、密钥、模型、上下文预算。发现、连接测试与保存互相独立，测试仅要求 `session_info`，不执行远端操作。远端地址必须 HTTPS，HTTP 仅允许 loopback；禁止 URL 凭据、查询串与片段。网络沿用 Electron 系统代理和 TLS，不跟随重定向。同地址留空密钥保留原值，换地址不复用旧密钥。

主进程监督外部 CLI，通过每轮独立私有 IPC 与受管 stdio MCP 连接业务进程；无本地业务 HTTP/WebSocket 服务。Unix socket 权限0600、临时目录0700，随机令牌绑定每轮受管CLI/MCP桥接。每轮工具顺序调度，上限32步，最多4个并行对话。

| 驱动 | 运行入口 | 限制 |
|---|---|---|
| Codex | `app-server --listen stdio://` | 临时禁用现有 MCP、本机 shell/文件相关入口、浏览器、插件、apps、多 Agent 等；只读沙箱，拒绝原生命令/文件请求 |
| Claude Code | 程序化 `stream-json` 接口，使用用户选择的 CLI | `--bare --setting-sources ""`、临时禁用 hooks/插件命令源，`--tools "" --strict-mcp-config --permission-mode dontAsk`，仅 eizhu MCP |
| DeepSeek Harness | `sdk-minimal` stdio JSON-RPC | 临时独立配置目录与 YAML 禁用 fs/工作目录/bash/pwsh 插件，仅添加 eizhu MCP；会话记录仍写入原生 home 下的 sessions；需要原生模型名与 CLI 环境中的 `DEEPSEEK_API_KEY` |

驱动表集中注册于 `apps/desktop/src/main/ai-cli.ts`。不兼容的启动参数、初始化协议或本机执行请求会使运行明确失败；版本检测可用不表示真实模型任务已验收。CLI 原生结构化提问暂被拒绝或取消，可在普通文字回复中提出问题。切换模型或 Agent 会停止旧运行，以摘要与近期记录新建后端会话；供应商专有推理项和调用 ID 不跨后端续接。

## 官方 AI 网关

产品固定地址 `https://eizhu.yuweinfo.com/api/ai/v2`，使用已有用户访问令牌 `Authorization: Bearer <accessToken>`。网关只推理，不建立 SSH 连接、不执行工具、不接收 SSH 凭据。

`GET /capabilities` 返回：

```json
{
  "toolsetVersion": 2,
  "available": true,
  "models": [{"id": "configured-model", "name": "运维模型"}],
  "defaultModel": "configured-model",
  "dailyTokenLimit": 100000,
  "remainingTokens": 98000,
  "message": ""
}
```

`POST /responses` 接受原生 Responses 输入和 SSE 输出。桌面发送 `model/input/stream/store/include/parallel_tool_calls/tools/tool_choice`；服务端从自身 v2 清单替换工具定义，校验选择集合、完整参数以及调用/结果配对，保留原生 reasoning 项。摘要请求可不带工具；完成事件不得包含未选工具。只接受已有模型，禁止客户端指定上游、密钥或输出预算。

网关转发完整原生增量事件。仅在上游正常完成、工具参数有效且可信 usage 已持久化结算后发送最终 `response.completed`。中断、失败、缺少用量、结算失败均不产生有效完成事件。工具调用可多条，单步骤最多32条，桌面仍顺序执行。最终输入/输出 Token 总量结算，缓存/推理明细不重复累加。

准入预算为规范化请求 UTF-8 字节数 + 256 Token 余量 + 模型输出上限；余额含已用和预占，按北京时间自然日统计。新用户额度默认0。跨午夜计入准入日；超预算实际用量完整入账并停用模型。未知用量保留预占，租约过期只释放并发名额，不重放请求。总时限110秒，账号并发2、全局16、每账号每分钟20次，由数据库协调。模型管理测试最多256输出 Token，独立记录；普通调用仍检查验证、账号状态和令牌撤销。

迁移 V14 保留模型密钥、用户额度、已用和未知预占，清除模型测试状态并关闭 AI。部署后管理员重新测试、启用模型并开启服务。桌面和 admin 必须协调部署，不保留 v1 路由兼容。

| 错误 | 行为 |
|---|---|
| 401/403 | 显示认证或权限错误，保留对话 |
| 429 | 额度不足或限流，不自动重试 |
| 503或其他失败 | 显示服务错误，不自动切换后端 |
| 流中断或无效事件 | 不产生工具操作，禁止自动重放 |

桌面请求限512KiB、响应限2MiB、模型总时限120秒；反向代理应关闭 SSE 缓冲。普通日志不记录令牌、密钥或完整请求正文。

## 清单同步与验收

在桌面仓库执行 `node scripts/export-ai-tools.mjs --out=<独立后台仓库>/src/main/resources/ai-tools-v2.json` 导出清单；`--check=<路径>` 只读校验两端一致。后台源码与提交独立管理。

`npm run desktop:smoke:ai` 使用 Electron、真实数据库 Worker、loopback SSH/模型验证闭环。`npm run desktop:accept:ai -- --local --port=<端口>` 使用桌面实际 SDK 与本机独立网关，令牌只从 `EIZHU_AI_ACCEPT_TOKEN` 环境读取，验证工具协议与结算，不执行远端工具。不传 `--local` 即拒绝。真实模型、真实 CLI 登录任务、远端 PTY 与跨平台证据须另行记录。

协议依据：[AI SDK Core](https://ai-sdk.dev/docs/ai-sdk-core/overview)、[Codex app-server](https://learn.chatgpt.com/docs/app-server)、[Claude Code headless](https://code.claude.com/docs/en/headless)、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。字段和限制以 contracts 运行时 schema 为准。
