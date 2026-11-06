# 账号同步第二批：账号闭环

日期：2026-10-27。第一批已按用户要求提交为 `8cfa5e1`，未推送。本文记录第二批实现与实际验证；条目同步、首次接入及同步开关仍未开放。

## 实现与差异

| 部分 | 第二批结果 |
|---|---|
| 账号 UI | 中文紧凑表单：登录、注册、邮箱验证、找回登录密码、用量、刷新、重新登录、切换与退出；密码只在表单临时状态中使用 |
| 领域边界 | contracts 的账号方法逐项启用 schema；仅主窗口可管理账号；令牌不返回 renderer；无通用网络/数据库桥接 |
| 服务端 | 固定 `https://eizhu.yuweinfo.com/`，登录/注册前检查初始化状态；桌面端不调用 `POST /api/auth/setup` |
| 会话 | 数据库 Worker 加密保存 access/refresh token；串行刷新、预期令牌 CAS、到期定时刷新；旧响应不能覆盖或清空新登录 |
| 未知结果 | 登录注册、验证码、密码重置和吊销不做业务重放；刷新响应丢失清除该会话令牌并要求重新登录，保留本地数据与解锁缓存 |
| HTTP | main/core 两侧校验服务端、方法、路径和大小；独立内存 Session，禁用 Cookie、重定向和缓存；控制请求串行，POST 前关闭旧连接 |
| 空间切换 | 主进程确认未保存文件后冻结编辑器输入；失败恢复编辑，成功切换才关闭旧编辑器。旧任务与进程实际释放后打开新空间 |
| 退出 | 远端不可用或吊销响应丢失仍可退出本机；活动空间与会话/解锁缓存删除在同一 SQLite 事务提交，业务库保留 |
| 兼容与定位 | 保持全局 v2 / 业务 v3、原离线密文及备份格式；登录不会复制离线条目或上传云端条目；备份与账号同步独立 |

账号状态事件带运行实例、空间和代次；普通旧响应被丢弃。登录/退出的专用响应允许 preload 校验并接受已确认的新上下文，同账号重新登录保留当前运行实例。

真实 Electron 测试发现 Chromium 会在复用连接、响应未返回时重发 POST，因此没有沿用普通 `net.fetch` 连接池直接提交认证写操作。现在账号控制面独立串行，写入前关闭该 Session 的连接；故障注入分别断开刷新、注册与退出的响应，并核对提交计数没有重放。依据：[Chromium 重发条件](https://chromium.googlesource.com/chromium/src/+/HEAD/net/http/http_network_transaction.cc)、[Electron Session](https://www.electronjs.org/docs/latest/api/session)。系统代理/TLS 与证书校验保留。

## 验证与证据

| 检查 | 结果 |
|---|---|
| 类型 / lint / 架构 | 通过；最终包前已复核，renderer 无 Node 导入、core 无 Electron 导入 |
| Foundation 回归 | 109 项通过，含并发刷新、迟到 401、新登录与旧刷新竞争、关闭取消、固定地址边界 |
| Web 回归 | 69 个测试文件、290 项通过；覆盖注册确认、重复提交锁、失败保留表单、密码不入 Zustand、重新登录状态 |
| 固定兼容 | `baseline:verify` 与 10 项 `baseline:test` 通过，未修改样本 |
| Electron 构建烟测 | macOS x64 通过，包含实际 renderer/preload/main/utilityProcess/SQLite Worker 和本机合成 HTTP 服务 |
| 最终安装包 | `0.5.0-test.339.8cfa5e14` macOS x64 DMG 通过；只读挂载、复制至临时目录运行，`packaged:true`；未签名、未公证 |

原生检查包含：初始化阻断、受限注册拒绝；编辑器取消发生在认证请求前；确认后锁定、认证失败恢复；新账号独立空间与邮箱验证；两个并发请求只刷新一次；离线保留会话和数据、运行进程重启；刷新响应丢失后不重复提交；登录密码重置与重新登录；吊销响应丢失仍退出本机；双账号与离线数据隔离；注册响应丢失只发送一次，手动登录可恢复；普通列表不含令牌；同步和同步开关继续拒绝。

额外 SQLite 触发器验证：令牌 CAS 拒绝旧结果；退出清理中途失败时，活动空间和会话删除一起回滚。已有 SSH、SFTP、编辑器、本地/第三方备份与更新烟测同时回归。

共 409 项自动回归通过。最终安装包记录与各检查结果已归档至 [macOS x64 证据](evidence/account-closure/darwin-x64.json)。DMG 位于 `artifacts/desktop/eizhu-0.5.0-test.339.8cfa5e14-mac-x64.dmg`，大小 158,144,875 字节，SHA-256 为 `28c6f3601e7d3daa729a5c301f65d8a9d9e87956bde2acb5f80ad233bea59af7`。证据对应第一批提交之上的第二批工作区修改，第二批尚未提交。

界面已检查 [浅色登录](evidence/account-closure/account-login-light.png)、[深色账号](evidence/account-closure/account-signed-in-dark.png) 和 [900×720 窗口、18px 字号](evidence/account-closure/account-signed-in-narrow.png)；未见横向溢出，账号按钮可用。截图仅含合成账号。

## 部署边界与下一批

- 只读复核线上 `/api/auth/setup` 已返回 `required:false`；没有创建线上账号、发送真实邮件、写入云端或修改独立后台仓库。
- 真实后端登录、SMTP 投递、部署受限模式、HTTPS/代理环境、系统密钥库、其他三个目标、签名公证和长期运行仍待验。合成服务通过不代表这些项目通过。
- 下一批实施同步密码学、首次接入预览、outbox/CAS/幂等、增量与 SSE、冲突及依赖处理。当前账号空间可以本地使用，界面明确提示“待接入”，不会假装云端同步成功。
- 第二批完成后仍按用户确认的分批约定交付审查结果，经确认再进入同步引擎批次；本轮不推送或发布。
