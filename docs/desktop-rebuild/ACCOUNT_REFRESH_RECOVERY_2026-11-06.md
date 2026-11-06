# 账号刷新临时失败恢复

日期：2026-11-06。

此前客户端将刷新请求的所有异常都当作登录失效，断网、超时、限流、服务端 5xx，甚至关闭运行实例时取消请求，都会清空本地会话令牌。

本次仅调整桌面客户端：临时网络和服务端错误保留加密保存的令牌、账号空间、同步偏好与解锁缓存，5 秒后再次尝试；限流使用服务端 Retry-After，等待期间共享一次刷新结果，避免多个同步/账号请求反复触发刷新。恢复网络后成功续期并恢复常规定时刷新。关闭或切换空间取消请求不再清除令牌，也不启动重试。旧请求仍使用 refresh token CAS，不能覆盖或清理新登录。

只有服务端明确返回未认证、刷新令牌无效或账号禁用时才清除会话令牌，保留业务库和解锁缓存。主动退出和修改/恢复主密码仍按原规则撤销会话。

## 服务端边界

服务端仍使用一次性刷新令牌：重试始终使用数据库中同一令牌，服务端原子消费保证同一令牌最多成功轮换一次。如果服务端已经轮换，但新令牌响应丢失，当前客户端无法恢复新令牌；再次尝试会得到明确的 INVALID_REFRESH_TOKEN，届时需要重新登录。本次不增加刷新结果恢复接口，不修改独立 admin 仓库、数据库 schema 或部署配置，也没有访问生产服务。历史报告中“刷新响应丢失立即要求重新登录”的验收描述由本说明修正，不修改历史证据或固定兼容样本。

## 验证

- `npm run check`、`npm run lint`、`npm run baseline:verify`、`npm run architecture:verify` 通过。
- `npm test`：Foundation 261 项、Web 1000 项、固定基线 10 项通过，合计 1271 项通过；Foundation 另有 2 项因本机环境条件跳过。固定样本未修改。
- 账号与边界定向回归 21 项通过，包含离线刷新保留全部会话字段、自动恢复、共享刷新与重试等待、429 等待时间、503、轮换结果丢失后仅明确拒绝才失效，以及关闭时取消不清令牌。
- `npm run desktop:build`、`npm run desktop:accept:sync -- --synthetic` 通过；两个临时客户端使用真实 Electron 业务进程、SQLite/计算 Worker 与本机合成 HTTP/SSE，不能视为生产后端或两台物理设备验收。报告位于忽略的 `artifacts/acceptance/synthetic-darwin-x64.json`。
- `npm run desktop:smoke`：macOS x64 完整通过，`packaged:false`。实际 renderer → preload → main → utilityProcess → 数据库 Worker 验证刷新断网不清会话、重启保留、联网后续期，以及响应丢失先保留会话、明确拒绝后失效。同步链路及 SQLite/KDF、SSH/SFTP、备份、编辑器、更新合成回归通过。报告位于忽略的 `artifacts/smoke/darwin-x64.json`，关键步骤为 `refresh-offline-session-survives-restart-and-reconnect` 和 `refresh-rotation-lost-response-and-offline-restart`。首次沙箱内 Electron 启动退出，改用沙箱外已安装的 Electron 后通过；未下载测试二进制。

上述初次交付未执行其他平台、生产部署、签名/公证或最终安装包验证。后续当前工作区整体 macOS x64 DMG 验收已覆盖账号刷新与同步，结果见 [SSH 目标与同步配置一致性记录](SSH_TARGET_CONSISTENCY_2026-11-06.md)；其他平台、生产部署与签名/公证仍待验。
