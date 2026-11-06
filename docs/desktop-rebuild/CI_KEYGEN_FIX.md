# CI Ed25519 密钥生成修复

2026-10-21，更新适配提交 `3460c685` 的 [测试构建](https://github.com/AfterYuWei/eizhu/actions/runs/39594071270) 中，macOS x64/arm64、Linux x64 最终包烟测通过，Windows x64 在阶段 3 `details-path-completion-passed` 之后返回 `KEYGEN_ERROR`。预览发布任务因此跳过，没有公开残缺版本。

失败位置是 `vault.generateKeyPair` 对新公钥的解析。锁定的 ssh2 1.17.0 将 DER BIT STRING 的所有前导零都删除；Ed25519 公钥必须保留完整 32 字节，只应去除首个 unused-bit-count 字节。合法公钥自身以零字节开头时，生成的公钥及私钥中的公钥字段均被截短。这与 [上游问题 1513](https://github.com/mscdex/ssh2/issues/1513) 一致，不是 Windows 专属故障。

修复范围：

- `scripts/patch-ssh2-keygen.mjs` 仅修正 Ed25519 BIT STRING 的截取，不修改 RSA/ECDSA，也不更换随机密钥或重试掩盖错误。
- `npm ci` 的原生准备步骤、桌面构建及打包前均检查并应用补丁；限定 ssh2 1.17.0 和预期源码，版本或代码不匹配时拒绝继续。
- 补丁脚本和执行入口纳入构建来源指纹。依赖版本、锁文件及原生 ABI 不变。
- 新增固定合成种子 36 的回归，其公钥以 `00 00 1f` 开头；明文和口令加密两种模式均验证公私钥一致、保留 32 字节、签名验签及错误口令拒绝。

本地已将原始编码逻辑放回依赖后运行固定样本，两种模式都复现 `Malformed OpenSSH public key`，随后恢复修正版本并通过回归。完整 298 项测试（基础 73、前端 215、固定兼容 10）、类型、lint、架构和固定格式检查通过；补丁重复执行不改写文件，未知版本和未知源码会拒绝执行。

本机为 macOS x64。最终安装包与 Windows 等目标平台结果以修复提交对应的 [四目标测试工作流](https://github.com/AfterYuWei/eizhu/actions/workflows/build-desktop-test.yml) 为准，不能用本地 Node 回归替代 Windows Electron 最终包验收。未签名候选与真实签名升级的验收边界保持不变。
