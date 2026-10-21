# 阶段 0：基线冻结交付报告

日期：2026-10-20（Asia/Shanghai）。来源提交：`d8a20e0f77ab04af4a4a729f94884a68c4022a5f`。

状态：**阶段 0 已于 2026-10-20 获用户确认（“确实进入阶段1”）；下文检查结果是阶段 0 的历史证据。**

## 交付内容

| 产物 | 内容 |
|---|---|
| [已确认目标](README.md)、[架构约束](ARCHITECTURE.md) | 14项设计选择、目录/进程/事务/通信/安全/发布边界及阶段门禁 |
| [功能覆盖表](FEATURE_BASELINE.md) | 39项入口、保留行为、异常路径、原生验证要求及已有证据 |
| [旧接口清单](../../tests/fixtures/desktop-baseline/legacy-interfaces.json) | 全部183个注册命令与原签名、定义位置、静态前端引用、处理决定和7个事件；未发现未登记的command定义 |
| [兼容样本](COMPATIBILITY.md) | 7个有效文件（6个非空三模式样本+历史XControl空样本）、10个反例、原始payload字节、密钥包装/条目/墓碑/Push固定向量 |
| [截图与操作](OPERATIONS.md) | 10张1280×720截图、正常UI操作步骤和明确的原生/连接状态缺口 |
| [冻结清单](../../tests/fixtures/desktop-baseline/manifest.json) | 636个原源文件Git blob、参考生产者摘要与37项资产摘要；修改/添加资产会使校验失败 |

命令处理决定：134个替换领域契约、26个替换平台契约、16个移除旧命令别名但保留对应业务、3个删除旧迁移入口、2个删除移动生命周期入口、2个删除移动Base64传输入口。
当前两个平台注册表列出同一组命令，注册平台本身不是删除移动端的判断依据。

三个eizhu样本来自原导出服务；三个XControl非空样本是经原读取/导入服务验证的兼容构造样本，不冒充历史应用导出。已有Go/XControl密文另行原样保留。
10个反例由原服务分别执行直接导入和隔离预览，记录实际错误码，并确认原业务payload未被部分改写。

## 实际验证结果

本机Node 24.22.0；临时Rust 1.99.1位于/private/tmp，仅用于旧实现参考验证，未修改用户全局Rust配置。

| 检查 | 结果 |
|---|---|
| `npm --prefix web run test:unit` | 60个文件、251项通过；既有React act环境提示仍存在 |
| `node --test scripts/*.test.mjs` | 18项通过，其中新增10项基线检查、原有8项发布配置检查 |
| `npm --prefix web run lint` | 通过 |
| `npm --prefix web run build` | TypeScript与Vite通过；保留既有终端chunk超过500kB提示 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | 通过 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features --locked -- -D warnings` | 通过，0告警 |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --all-features --lib` | 175项通过、0失败/忽略，含新增3项参考测试 |
| 原Rust→固定文件→独立Node Argon2id/AES-GCM验证 | 通过；包含中文密码、旧AAD、精确明文字节、同步身份绑定及根据公钥独立核对的SHA-256主机指纹 |
| 错误密码/AAD、tag篡改、身份/修订/epoch/删除状态变化 | 独立Node验证拒绝 |
| 固定文件修改、额外未审查资产、路径逃逸、孤立验收编号和重复接口 | 基线检查拒绝 |
| macOS不可见AppKit几何脚本 | 正常/紧凑控件×3尺寸共6组通过，重复布局与32pt中心线通过 |
| `git diff --check` | 通过 |

原Rust套件的SSH/SFTP协议证据包括其本地测试服务；本轮没有将它们宣称为真实OpenSSH、云账号或四平台实机验收。
Node脚本当前是固定证据校验器，尚不是新架构生产导入器、数据库或业务运行时。

## 修改与数据边界

本轮新增文档、合成固定文件、截图、采集/校验脚本，以及仅cfg(test)编译的旧实现参考生产者。
根脚本增加baseline入口；CI frontend调整到Node24并获取完整Git历史，以便独立验证固定历史源。
AGENTS和README记录阶段事实；完整开发规范在新工程真实存在后重写。

现有React业务源码、桌面样式和生产业务逻辑未改。未读取或迁移真实应用数据库、凭据、设置或任务；未修改admin内容。
保留原有CLAUDE.md/CODEBUDDY.md删除状态。未推送、发布、部署或触发真实云端写操作。

## 尚未覆盖的原生证据

- 四平台原生窗口、字体/缩放、拖放、系统密钥库和安装更新。
- 真实连接后的终端、分屏、SFTP、任务、详情和独立编辑器截图/操作。
- 双客户端真实同步、第三方云目标、OAuth回调、签名公证及实际自动更新。
- 新架构的20连接/4活跃终端/5路传输性能、8小时稳定性和四目标包烟测。

浏览器截图只证明当前可见场景，不替代这些证据。平台实测与签名按已确认计划在对应阶段单列结果，不能把待验证项写成通过。

## 下一阶段门禁

请审阅功能覆盖、接口处理决定、样本来源以及截图的环境边界。用户确认阶段0产物后，进入阶段1：建立npm workspaces、Electron窗口、preload、独立业务进程、Worker和新数据目录，并提供四目标基础烟测与桌面外壳对比。

用户验收记录：**待确认**。本报告不以自动测试成功代替用户的阶段确认。
