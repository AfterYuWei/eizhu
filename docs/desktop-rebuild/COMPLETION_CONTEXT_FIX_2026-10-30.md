# 四项补全上下文缺陷修复

日期：2026-10-30（Asia/Shanghai）。对应首次完整测试报告中的 CTX-01–04。本轮未发布、未连接用户生产服务器。

## 原因

这是补全语法规格与实际查询上下文之间的对接遗漏：

1. 规格中声明了四种选项，解析器会消费它们及其参数，但此前只记录选项名称和当前待填参数，未保存这些值供动态查询使用。
2. `CompletionParams` 与严格 IPC schema 缺少对应结构化字段，后端固定模板也没有应用这些选项。因此带选项和不带选项会生成同一查询对象。
3. 前后端缓存都按生成器参数及 cwd 建键；上下文值丢失后，缓存同样无法区分这些目标。

已确认的是上述源码与实际请求行为。没有据此认定四项问题一定由 Rust → Electron 迁移引入。

## 修复行为

| 项目 | 现在如何查询 | 补充覆盖 |
| --- | --- | --- |
| `git -C` | 将按顺序解析的目录通过 `gitDirectories` 传入 Git `-C` 参数 | 分支、远端、连续相对 `-C`；文件候选也相对指定仓库读取，当前正在输入的下一段 `-C` 路径使用前面已完成的目录 |
| `docker -H` | `dockerHost` 成为固定 `docker --host=... ps` 的参数 | 普通容器和全部容器模式，带空格的 Unix socket，切回默认目标 |
| `kubectl --kubeconfig` | `kubeconfig` 应用于资源查询和 context 列表查询 | 引号、等号形式；未指定 `-n` 时使用所选配置的默认命名空间，明确指定时按最后一个值查询 |
| `systemctl --user` | `systemdUser` 控制固定 `systemctl --user ...` 查询 | 服务文件、活动服务、失败服务三种生成器 |

参数继续经过共享的严格 schema。上下文字符串最多 32,768 字符，拒绝控制字符；连续 Git 目录最多 8 段，用户服务开关要求布尔值。后端对字符串操作数逐项引用，未开放任意脚本。现有缓存键自动包含新增参数，切换上下文会使用不同条目。

## 测试

新增 `apps/web/src/lib/completionContext.test.ts` 的 8 项回归，修复前 8 项均失败，修复后通过。其中包含原 4 项诊断，以及顺序/引用/等号/`--` 边界、Git 文件候选、kubeconfig 命名空间和参数隔离。

| 层级 | 结果 |
| --- | --- |
| 前端上下文 + 原规格矩阵 + 引擎 | 558 项通过 |
| 上下文 + 规格矩阵 + 输入交互 + API 参数序列化 | 562 项通过 |
| 共享输入契约与固定命令模板 | 6 项通过；覆盖字段类型、长度、数组上限、控制字符及危险字符引用 |
| 真实本机 SSH/SFTP 集成 | 19 项通过；Git 使用多个真实临时仓库，其余工具使用会区分上下文的显式 CLI 夹具 |
| 当前工作区完整 Web | 883 项通过，含本轮 8 项新增上下文回归；该工作区也包含独立的详情/会话回归变更 |
| Foundation | 154 项通过、1 项 Fish 实测跳过 |
| 固定兼容 | 固定证据只读校验通过，10 项兼容回归通过 |
| 类型、完整 lint | 通过 |
| 最终 macOS x64 安装包 | 完整烟测通过，`packaged=true`；71 个 xterm 场景、13 组动态选中写回、19 次生成器查询通过 |

Electron 验收新增四组真实 xterm 输入、选中和 SSH 写回：指定仓库、指定 Docker host、指定 kubeconfig、用户服务；原默认上下文场景继续运行，以验证切回默认目标后不会读到覆盖目标的缓存。还对受影响的 8 种动态查询分别检查不同输出。

原 CTX-01–04 均已修复，当前回归未发现这四项残留失败。

## 证据与产物

- 构建基于 `1ea30fc0` 加本轮修复，未签名产物为 `eizhu-0.5.0-test.355.1ea30fc0-mac-x64.dmg`。
- [机器摘要](evidence/completion-context-20261030/summary.json)包含源码指纹、DMG SHA-256、平台及场景计数。
- [修复前 8 项失败](evidence/completion-context-20261030/before.log)、[修复后前端专项](evidence/completion-context-20261030/frontend-focused.log)、[19 项 SSH/SFTP 集成](evidence/completion-context-20261030/ssh-integration.log)、[最终安装包烟测](evidence/completion-context-20261030/package.log)。
- [当前 Web 全套](evidence/completion-context-20261030/web-full.log)、[Foundation 全套](evidence/completion-context-20261030/foundation.log)、[字段与命令引用](evidence/completion-context-20261030/contracts-commands.log)；类型、lint、固定兼容日志均在同目录。原始日志保留工具输出空白。
- [指定 Docker host 的候选截图](evidence/completion-context-20261030/completion-context-host.png)、[切回默认目标的候选截图](evidence/completion-context-20261030/completion-docker-light.png)。两者分别返回 `qa-web` 与 `web`。

## 验证边界

- Git 的仓库切换通过真实 Git 执行验证；所有 SSH/SFTP 都使用隔离的本机回环服务及临时文件。
- Docker、kubectl、systemctl 使用显式 CLI 夹具与 Electron 合成服务，没有连接实际 daemon、集群或 Linux 用户 D-Bus。此处通过代表上下文传递、固定参数、解析及交互通过，真实服务验收仍待执行。
- 本机 macOS x64。其他三个客户端目标、Fish 实测、原生 IME 候选窗、签名/公证、真实更新与长时间运行仍待验。
- 保留首次报告、失败日志和旧产物指纹；本报告追加新的修复结果与证据，不覆盖历史失败记录。
