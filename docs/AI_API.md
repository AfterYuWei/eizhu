# 官方 AI 网关接口契约

本仓库已实现桌面客户端；以下为独立后端需要实现的对接契约，不表示官方服务已部署或通过真实模型验收。本次未读取、修改 `admin/`，也未向生产发送账号或 AI 请求。

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

未登录或令牌失效返回 401，无权访问返回 403。客户端不会因为官方请求失败而自动将对话发送至其他服务。

## POST /chat

接收 OpenAI Chat Completions 兼容请求，响应 `text/event-stream`。桌面端发送：

- `model`：能力接口提供的模型 ID。
- `messages`：`system/user/assistant/tool` 消息，包括已批准命令的结果。
- `stream: true`、`parallel_tool_calls: false`。
- `tools`：仅提供 `run_command`，采用函数工具定义；参数如下，全部必填，禁止额外字段。

| 参数 | 类型 | 含义 |
|---|---|---|
| command | string | 完整非交互 POSIX shell 命令，最多 16384 字符 |
| cwd | string | 绝对工作目录，最多 32768 字符 |
| purpose | string | 中文目的说明，最多 2048 字符 |
| impact | string | 中文影响说明，最多 2048 字符 |

流使用 `data: <JSON>\n\n`。文本增量位于 `choices[0].delta.content`；命令增量位于 `choices[0].delta.tool_calls[0]`，包含 `index: 0`、唯一 `id`、`function.name: "run_command"` 和分片的 JSON `function.arguments`。正常结束返回 `finish_reason: "stop"` 或 `"tool_calls"`，随后可返回 `data: [DONE]`。

客户端只在完整结束且参数校验通过后展示可执行卡片。确认发生在桌面端，网关和模型均不能确认命令。执行结果通过匹配原工具调用 ID 的 `tool` 消息回传，包含状态、stdout/stderr、退出码、耗时及截断标识；结果未知时明确标记，不能当作命令失败后自动重跑。

后端应原子预占额度和并发名额，对实际用量结算并释放未使用额度；请求断开不能据此断言上游未计费。模型输出上限由后端配置，禁止信任客户端自报用量或任意上游地址。首版不提供购买、支付或订阅接口。

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

## 自配协议

用户填写的是 API 基础地址，例如 `https://api.example.invalid/v1`。桌面端分别追加 `/chat/completions` 或 `/responses`；Responses 采用原生事件格式并保留推理续接所需的返回项。模型必须支持函数工具调用，“保存并测试”会要求返回一条测试工具调用，但绝不执行该测试命令。

远程地址必须使用 HTTPS，HTTP 只允许 `localhost`、`127.0.0.1`、`[::1]`。禁止 URL 内嵌用户名、密码、查询串或片段。网络使用 Electron 系统代理和 TLS 校验，凭据不随重定向转发。

工具流程参考：[OpenAI 官方函数调用文档](https://developers.openai.com/api/docs/guides/function-calling)。最终字段和边界以 `packages/contracts/src/ai.ts` 为准。
