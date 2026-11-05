# 官方 AI 网关接口契约

桌面客户端和独立 admin 后端均已实现以下接口；管理端支持模型配置、加密密钥、用户额度和用量查询。实施与本机隔离验收不代表官方生产服务已部署或通过真实供应商验收；未向生产发送账号或 AI 请求。

## 地址与认证

产品固定使用 `https://eizhu.yuweinfo.com/api/ai/v1`，复用现有用户访问令牌：`Authorization: Bearer <accessToken>`。用户自配模型使用独立配置和密钥，直接连接其配置的服务。

后端负责验证用户身份、可用模型及每日额度；模型供应商密钥仅保存在后端。网关只负责模型推理，不建立 SSH 连接，不执行模型生成的命令，不接受 SSH 密码或私钥。

## GET /capabilities

返回 `application/json`：

```json
{
  "available": true,
  "models": [{ "id": "configured-model", "name": "运维模型" }],
  "defaultModel": "configured-model",
  "dailyTokenLimit": 100000,
  "remainingTokens": 98000,
  "message": ""
}
```

数值仅为协议示例，部署时必须配置实际模型和额度。未配置时返回 `available: false`、空模型列表、空默认模型、零额度和明确中文说明。模型 ID 最大 160 字符，列表最多 100 项；额度为非负安全整数。每日用量按北京时间自然日统计。客户端额度展示不作为授权依据。

新旧用户每日额度默认均为 0，由管理员在用户详情中分配。服务已配置时，即使用户额度为 0，仍返回模型与零剩余额度；新建对话和服务端推理请求均受额度限制。剩余量扣除已用及预占额度，不包含供应商密钥或地址。

未登录或令牌失效返回 401，无权访问返回 403。客户端不会因为官方请求失败而自动将对话发送至其他服务。

## POST /responses

客户端、网关和供应商上游均使用原生 Responses API；不再提供 Chat Completions 路由、配置或转换层。响应为 `text/event-stream`。

桌面请求包含 `model`、`input`、`stream: true`、`store: false`、`include: ["reasoning.encrypted_content"]`、`parallel_tool_calls: false`，以及唯一的 `run_command` 函数工具。模型、工具定义、上游地址、密钥与 `max_output_tokens` 由服务端决定；用户不能覆盖输出预算。输入包含文本消息、原生 reasoning/message/function_call 返回项，以及匹配 `call_id` 的 `function_call_output`；不使用服务端存储的会话或 `previous_response_id`。

```json
{
  "model": "configured-model",
  "input": [{ "role": "user", "content": "检查服务器状态" }],
  "stream": true,
  "store": false,
  "include": ["reasoning.encrypted_content"],
  "parallel_tool_calls": false,
  "tools": [{
    "type": "function",
    "name": "run_command",
    "description": "请求用户确认一条命令",
    "strict": true,
    "parameters": {
      "type": "object",
      "properties": {
        "command": { "type": "string" },
        "cwd": { "type": "string" },
        "purpose": { "type": "string" },
        "impact": { "type": "string" }
      },
      "required": ["command", "cwd", "purpose", "impact"],
      "additionalProperties": false
    }
  }]
}
```

| 参数 | 类型 | 含义 |
|---|---|---|
| command | string | 在当前 SSH 窗口交互式 shell 执行的完整命令，最多 16384 字符；沿用终端环境，交互输入由用户在终端完成 |
| cwd | string | 绝对工作目录，最多 32768 字符 |
| purpose | string | 中文目的说明，最多 2048 字符 |
| impact | string | 中文影响说明，最多 2048 字符 |

SSE 使用 `data: <JSON>\n\n`。网关转发 `response.output_text.delta` 的 `delta` 文本，保留完整输出项直到最终 `response.completed`。最终事件的 `response.status` 必须为 `completed`，`response.output` 中至多一个 `function_call`，工具名必须为 `run_command`，包含 `call_id` 和完整 JSON `arguments`。

只有上游流完整、工具参数有效，且 `response.usage.input_tokens + output_tokens` 已持久化结算后，才发送最终完成事件。缓存输入和推理 Token 属于这两个值的明细，不重复计算。`response.incomplete`、`response.failed`、缺少可信 usage 或结算失败都不会产生完成事件；桌面不能生成可执行命令。网关错误流为 `type: "error"`，仅包含安全错误码和说明。

确认发生在桌面端，网关和模型均不能确认命令。2026-11-04 起，AI 命令在绑定的当前 SSH 终端执行，不创建独立 exec 通道；终端忙或有未提交输入时拒绝派发，停止和超时向该终端发送 Ctrl+C，保留 SSH 会话。执行结果作为 `{ "type": "function_call_output", "call_id": "...", "output": "..." }` 回传，包含状态、stdout/stderr、退出码、耗时和截断标识；PTY 输出合并在 stdout，stderr 为空。结果未知时明确标记，不能自动重跑。旧版本对话仍可查看；协议升级前的上下文须新建对话才能继续。

准入预占预算为规范化上游请求的 UTF-8 字节数 + 256 Token 余量 + 模型输出上限。余额接近耗尽时可能提前拒绝；正常结算释放差额。超过预算的实际用量完整入账并停用模型。

总时限 110 秒；单账号并发 2、全局并发 16、单账号每分钟 20 次，均由数据库跨实例协调。跨午夜请求计入准入时的北京时间日期。缺少可信用量的中断及进程崩溃保留预占，租约过期仅释放并发名额，不自动重放请求。

管理员模型测试发送固定 Responses 请求，输出最多 256 Token，独立标记用量，不占普通用户配额；已登录且可用的管理员可在首次邮箱验证前测试。普通 AI 调用仍检查邮箱验证、账号状态和令牌撤销。桌面官方连接测试作为当前用户请求计入其额度。

## 错误与数据边界

| 情况 | HTTP 状态 | 桌面行为 |
|---|---|---|
| 认证失效 | 401 | 提示检查登录或密钥，保留本地对话 |
| 权限不足 | 403 | 显示无权访问 |
| 额度耗尽或限流 | 429 | 显示额度或频率限制，不自动重试 |
| 未配置、模型不可用或上游失败 | 503/其他非 2xx | 显示服务不可用，可手动选择自配模型 |
| 流中断、内容不完整、多个工具调用 | 中断或无效 SSE | 不生成可执行命令，不自动续跑 |

桌面端单请求最大 512 KiB，响应最大 2 MiB，总超时 120 秒；不跟随重定向。网关和反向代理需要关闭 SSE 缓冲，及时转发分块与断开。

后端实现时只保留必要的用量、状态和耗时元数据，禁止在普通访问日志中记录令牌、完整请求正文或模型密钥。需要独立核实上游供应商的数据保留政策，不能将本地加密历史等同于云端零保留承诺。

## 模型发现与连接测试

设置页使用统一的共享下拉组件，包含“自动发现模型”“测试连接”“保存设置”三个独立操作；发现和测试使用当前草稿，不自动保存，也不执行命令。

- 官方来源通过 `/capabilities` 发现公开模型，可选官方默认模型，同时展示今日额度。
- 自配来源向 API 基础地址追加 `/models` 发起 GET，读取 `data[].id`（可选 `name`），最多 1000 项并按 ID 去重。列表无法读取时保留手动填写模型名的入口；发现成功不代表支持 Responses，仍须测试。
- 自配推理只追加 `/responses`，连接测试要求返回 `run_command`，输出最多 256 Token。仅测试结果有效才提示成功，测试提议绝不进入 SSH 执行。
- 留空 API Key 保留同一地址的已保存密钥；接口地址改变后不会向新地址发送旧密钥。“清除密钥”仅清除已保存密钥，保留当前未保存草稿。

远程地址必须使用 HTTPS，HTTP 只允许 `localhost`、`127.0.0.1`、`[::1]`。禁止 URL 内嵌用户名、密码、查询串或片段。网络使用 Electron 系统代理和 TLS 校验，凭据不随重定向转发。

协议参考：[Responses 流式事件](https://developers.openai.com/api/reference/resources/responses/streaming-events)、[模型列表](https://developers.openai.com/api/reference/resources/models/methods/list)、[函数调用](https://developers.openai.com/api/docs/guides/function-calling)。最终字段和边界以 `packages/contracts/src/ai.ts` 为准。

## 本机协议验收

`npm run desktop:accept:ai -- --local --port=<本机端口>` 使用桌面实际的官方请求构造和流式解码器，通过仅供验收的 transport 转发至 `127.0.0.1`。令牌只从 `EIZHU_AI_ACCEPT_TOKEN` 环境读取，不落盘；不传 `--local` 即拒绝运行。该工具验证待确认工具提议和额度结算，不执行 SSH 命令，不更改产品固定生产地址，也不代表完整 Electron 或真实供应商验收。
