# 备份与同步兼容基线

来源：提交 `d8a20e0f77ab04af4a4a729f94884a68c4022a5f` 的实际模型与实现。
本文件规定对外数据交换契约，不要求新数据库维持旧 schema、key 文件或历史迁移逻辑。

## 文件与样本来源

| 资产 | 真实来源及已验证范围 |
|---|---|
| eizhu-none/plain/encrypted.eizhubackup | 原 BackupService.export_bytes 实际生成；原解码器、导入服务和再导出校验 |
| xcontrol-none/plain/encrypted.xcbackup | 从原导出内容构造旧 format/AAD 的兼容样本；原解码器与导入服务验证，并非声称来自历史 XControl 应用导出 |
| xcontrol-historical-empty.xcbackup | 原测试里已存在的 Go/XControl 固定密文，原样保留；导出密码 backup-pass |
| payload-*.json | 原解码模型序列化的精确 UTF-8 字节，用于验证字段省略、顺序和摘要 |
| backup-vectors.json | 合成备份密码、旧 Rust 计算的派生密钥及明文摘要；只用于测试 |
| sync-v2-vectors.json | 原 wrap/aad/seal 和 Push 序列化实际生成的密钥包装、普通条目、墓碑和请求 |
| invalid/ 与 invalid-cases.json | 10个反例及旧导入/预览错误码；原服务验证失败后完整原业务payload保持不变 |

非空样本包含父子分组、密码凭据、真正加密的 ED25519 OpenSSH 私钥、内联密码、共享凭据引用、Agent、SOCKS5/HTTP代理密码、SSH跳板关联、SHA-256主机指纹、未知options字段、中文/emoji和单行/多行片段。主机指纹由原SSH key库生成，并在Node中用公钥字节独立核对；合成私钥未在任何真实服务器部署。

反例覆盖过新版本、未知格式/凭据模式、循环分组、缺失跳板/凭据引用、篡改tag、缺失或非法KDF以及错误密码。原Rust服务分别执行直接导入与隔离预览，冻结实际错误码，并确认原业务数据保留。Node阶段0校验只检查这些反例的完整性和元数据，生产导入器对反例的拒绝及事务行为在阶段2实现和验证。

## 备份 v1

- format 为 `eizhu-backup` 或 `xcontrol-backup`，导出版本为整数1。
- credential_mode 为 `none`、`plain`、`encrypted`；保留 exported_at 和现有字段缺省语义。
- 加密时 Argon2id v0x13，输出32字节；默认 time=3、memory=65536 **KiB**、threads=2、16字节salt。
- 读取器校验既有 KDF 参数范围；不能只把参数硬编码成默认值。Node 基线验证器仅接受固定可信样本的默认参数，不充当生产导入器。
- 密码按原 UTF-8 字节处理，不 trim、不做 Unicode 归一化。中文、emoji和空白都不能被隐式修改。
- AES-256-GCM，12字节nonce、16字节tag；标准Base64包装 `nonce || ciphertext || tag`。
- eizhu AAD 为 UTF-8 `eizhu-backup:1`；XControl AAD 为 `xcontrol-backup:1`，不可混用。
- 明文业务对象按原结构序列化：groups、vault、profiles、snippets；字段顺序、省略空字段、null和options字符串会影响完整版本摘要。
- 完整版本 hash 是**加密前紧凑 payload 的 SHA-256**，不是备份文件hash，也不是原始JSON做任意键排序后的hash。

备份上限50MiB。完整业务导入校验、冲突策略和事务属于阶段2；Node独立验证只证明旧样本密码学和字节契约，不能据此宣称新导入业务已实现。

`none` 模式清空vault，移除内联凭据/代理密码/vault引用，并将原vault认证改为none；导入时不能把缺失凭据伪装为可连接。skip/overwrite/regenerate及group.parent_id、profile.group_id/vault_id、options.proxy.jump_profile_id的关联重映射必须独立验证。

恢复包括隔离预览、来源和变化摘要、merge/replace、安全快照、预览失效检查及完整事务回滚。旧备份没有界面设置、历史、传输、隧道或云目标配置，不承诺恢复这些不存在的内容。

## 账号同步 v2

原协议的关键字段使用camelCase。KeyEnvelope包含salt/time/memory/threads/wrappedKey/version/revision。
数据密钥是随机32字节；修改同步密码只重新包装同一个数据密钥。

- 密钥包装 AAD：`eizhu:key:2:<userId>:1`。
- 条目 AAD：无空白UTF-8 JSON数组 `["eizhu:item",2,userId,itemType,itemId,revision,epoch,1,deleted]`。
- 条目密文仍为Base64的 `nonce || ciphertext || tag`。
- Push：requestId、deviceId、epoch、replace、expectedSeq、items；Item保留itemType/itemId/baseRevision/revision/generation/deleted/payload/keyVersion/epoch。
- JSON数字、null、删除标记和精确AAD字节必须一致；实现时不得让JavaScript安全整数之外的协议数值静默舍入。

主要端点：认证 `/api/auth/*`；同步 `/api/sync/v2/{capabilities,devices,keys,snapshots,changes,requests,push,events}`；官方完整备份 `/api/backup/v1/{objects,indices}`；旧官方快照从 `/api/store/objects/*` 只读导入。精确请求方法、路径参数与错误契约以冻结源码为准，不改服务端来适配客户端误差。

密码学一致不等于同步语义一致。官方同步延后至后端部署后单独验证：本地事务/outbox原子性、冻结请求幂等、结果未知查询、CAS、代次、SSE重放、依赖顺序、冲突、旧确认保留新修改和首次接入保护。

## 冻结证据的使用方式

原 Rust 和 Node.js 分别验证同一组文件；错误密码、错误AAD、tag篡改及身份/修订/代次/删除状态变化必须失败。摘要检查阻止悄悄重写样本。

未来 Node 导入器应直接消费这些固定文件，输出预期语义和关联关系。不得为让新实现通过而重新生成“更方便”的旧样本。
