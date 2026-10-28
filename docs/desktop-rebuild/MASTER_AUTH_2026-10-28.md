# 注册前邮箱验证、主密码与统一账号弹窗

日期：2026-10-28。按用户确认的新数据库方案实施，不转换旧账号或旧同步密钥。桌面与独立后端需要配套使用；数据库由用户清理，本轮未清理数据、推送、发布或访问生产账号接口。

## 已实现行为

- 邮箱 → 验证码 → 主密码与确认 → 注册并登录。验证前只有短期 challenge，不存在正式用户或登录会话。验证码六位、10 分钟有效、每分钟一次、每小时五次，五次错误后拒绝继续验证；验证凭证绑定邮箱、短期有效且单次消费。
- 普通注册固定创建已验证的 USER。后台首次管理员仍由初始化入口创建，保留管理员密码登录与找回。原注册入口不能跳过验证；管理员密码重置入口不能修改主密码账号。
- 头像、账号设置、同步页和会话失效恢复共用账号弹窗。登录成功保留发起页面；取消未保存编辑器确认不会被当作登录成功。
- 同步页不再展示独立密码表单。登录自动解锁数据，首次同步仍需要预览和明确确认；取消预览不上传业务条目。
- 主密码修改和恢复均重新包装原数据密钥，原条目密文可继续使用。操作会撤销旧会话，客户端重新使用新主密码登录。写操作响应未知时不自动重放。

## 密码学与接口

参考 [Termius Vault](https://termius.com/vault) 的客户端加密/密钥保护，以及 [Bitwarden 技术说明](https://contributing.bitwarden.com/architecture/cryptography/crypto-guide/) 的认证材料与解密材料分离；不是 Termius 私有协议的复刻。

1. 主密码 12–128 个字符，原样处理，不修剪或规范化；设备端计算 Worker 使用 Argon2id v0x13，16 字节随机 salt、64 MiB、3 次迭代、并行度 2，输出 32 字节根密钥。
2. HKDF-SHA256 以随机且稳定的账号 cryptoId 为 salt，通过 `eizhu:master:1:authentication`、`eizhu:master:1:key-wrapping` 分离认证材料与包裹密钥。服务端保存认证材料的 BCrypt 散列，不接收主密码或包裹密钥。
3. 随机 32 字节 DEK 用于既有同步 v2 条目 AES-256-GCM 加密。DEK 的包装使用 AES-256-GCM、12 字节随机 nonce，并用 `eizhu:master:1:<cryptoId>:dek` 作为 AAD。密钥包 version=2，绑定 cryptoId、salt 和 CAS revision。
4. 设备恢复凭证由 DEK 使用独立 HKDF 用途 `eizhu:master:1:device-recovery` 派生，服务端只保存其 SHA-256 散列。恢复必须同时通过邮箱验证码及该凭证，邮箱单独重置、错误设备凭证均不能替换主密码。
5. 本机 DEK 与会话保存在设备密钥保护的数据库记录中；退出清除解锁资料，普通登录失效保留本地数据与解锁缓存。没有恢复码；所有设备失去解锁能力时无法恢复云端数据。Buffer 尽快清理，不承诺 JavaScript 字符串或 GC 可以可靠清零。

新增固定源 `/api/auth/master/` 下的 `registration/send`、`registration/verify`、`register`、`parameters`、`login`、`change`、`recovery/send`、`recovery/reset`。登录/注册响应内部包含 tokens 与 keys，令牌和数据密钥不返回渲染进程。密钥包与认证记录原子更新，停用同步独立密钥写入；同步业务条目协议保持 v2。后端 Flyway V10 增加主密码记录及注册前 challenge 支持。

客户端同步更新领域 schema、受限 preload 方法、网络白名单、Worker、加密会话持久化以及验收工具。真实验收仅允许全新隔离账号；旧会话续跑和“全新设备只凭邮箱重置已有账号”不再适用。

## 验证与边界

| 检查 | 结果 |
| --- | --- |
| 类型、lint、架构与固定格式兼容检查 | 通过；固定样本未重写 |
| Foundation / Web / baseline 回归 | 118 / 293 / 10 项通过，共 421 项 |
| 主密码固定输入向量 | 与 Node 原生 Argon2/HKDF 独立实现交叉核对；错误密码、用途分离、密码轮换保留 DEK 通过 |
| Electron 完整烟测 | macOS x64 通过：真实进程/SQLite/计算 Worker、未保存编辑器取消、认证响应丢失、记住解锁、首次预览及同步回归 |
| 双端合成验收 | 通过：注册前验证、四类条目、冲突、SSE、未知写入恢复、主密码轮换、设备恢复、旧会话失效与清理 |
| 独立后端 | 编译通过；认证过滤链/配置等 28 项定向测试通过 |
| 管理后台 Web | build、lint 及 26 项测试通过 |
| PostgreSQL 新协议集成 | 测试已添加并编译；执行因找不到 Docker 环境失败，未记为通过 |
| 本机真实后端与实际注册邮件 | 待配套部署和隔离测试环境，未执行 |
| 当前平台安装包 | macOS x64 `0.5.0-test.347.5dfce60e` DMG 完整烟测通过，`packaged:true`；版本、源摘要、大小与 SHA-256 见 [交付证据](evidence/master-auth/darwin-x64.json) |

Windows x64、macOS arm64、Linux x64、真实系统密钥库、签名/公证和长期运行仍待验。当前合成验证使用隔离临时数据目录及受限测试设备密钥，不代表上述目标通过。

后端集成测试覆盖未验证注册、过期/错误/重发、邮箱绑定、单次凭证、并发注册、密钥插入失败事务回滚、设备凭证恢复、密码更新与旧会话撤销；需要可用的 Docker/Testcontainers PostgreSQL 才能执行。管理员旧邮件测试改为管理员专用测试账号，业务同步测试通过新注册协议准备账号。

## 界面证据

[登录](evidence/master-auth/account-login-light.png) · [注册邮箱](evidence/master-auth/account-register-email.png) · [验证码](evidence/master-auth/account-register-code.png) · [设置主密码](evidence/master-auth/account-register-password-dark.png) · [账号设置](evidence/master-auth/account-signed-in-dark.png)。截图均为隔离合成账号，不包含真实凭据。
