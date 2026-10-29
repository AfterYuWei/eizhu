# 终端补全完整测试报告

日期：2026-10-29（Asia/Shanghai）。验收代码基于本地 `dev` 的 `049b3b3a` 加本轮修改，构建来源指纹见下文。未发布或连接用户的生产服务器。

## 结论

**普通会话上下文的已登记补全功能通过本轮自动化验证；整体仍有 4 项上下文选项缺陷，不能判定为全部通过。**

- Web 全套 **870 项通过**；其中补全专项 **593 项通过**，专项是全套的子集，不重复累计。
- Foundation 全套 **148 项通过、1 项跳过**；包含全部生成器的 SSH/SFTP 协议集成。跳过项为本机没有 Fish 的实际 Shell 执行。
- 固定兼容 **10 项通过**，固定证据只读校验通过。
- 额外执行的上下文诊断 **4 项失败**，对应 `git -C`、`docker -H`、`kubectl --kubeconfig`、`systemctl --user`。失败脚本与原始断言已归档。
- 上述测试合计 **1,028 项通过、4 项失败、1 项跳过**。Electron UI 的 67 个场景单列，不加到该测试框架计数中。
- 类型检查、完整 lint 和构建通过。macOS x64 构建输出的完整烟测通过；最终 DMG 的复验结果见下方安装包证据。

## 范围与用例矩阵

本轮覆盖当前终端补全的所有注册规格，不将远端 CLI 的全部命令视为本产品已实现能力。首词为预置的 27 项候选，文件参数规格共 25 个；动态查询由 10 类固定生成器提供。

| 命令族 | 规格层级（含根） | 本层声明选项数 | 动态入口数 | 验证内容与结果 |
| --- | ---: | ---: | ---: | --- |
| Git | 23 | 35 | 10 | 子命令、嵌套 remote/stash、分支、远端、文件、重复/互斥选项、`--`、引用和插入通过；`-C` 改变分支查询上下文失败 |
| Docker | 21 | 29 | 10 | 子命令/选项、运行中/全部容器、名称过滤、ID 描述、选项值、文件路径通过；`-H` 改变查询目标失败 |
| kubectl | 163 | 28 | 153 | 全部嵌套规格、15 类资源、9 组资源操作入口、命名空间前置/后置/等号形式、context、输出格式、配置路径候选通过；`--kubeconfig` 改变资源查询配置失败 |
| npm | 24 | 15 | 1 | 子命令、嵌套 config/cache/audit、静态参数、脚本查询/过滤/插入通过；脚本发现不执行 package scripts |
| systemctl | 21 | 12 | 15 | 子命令/选项、服务文件、活动服务、失败服务及插入通过；`--user` 改变查询模式失败 |
| 文件命令 | 25 | 使用通用文件参数规格 | 25 | 下列全部命令的路径参数在解析层和实际 Electron 窗口通过 |

规格层级合计 252、已声明选项 119、五组命令的动态入口 189。表中计数来自当前规格遍历；“层级可达”测试验证每层子命令和选项，不代表所有选项均已正确改变后端查询上下文。4 项失败单独列出。

25 个文件命令：`cd`、`ls`、`cat`、`less`、`more`、`head`、`tail`、`vi`、`vim`、`nano`、`rm`、`cp`、`mv`、`touch`、`chmod`、`chown`、`find`、`grep`、`mkdir`、`rmdir`、`tar`、`unzip`、`source`、`bash`、`sh`。

Kubernetes 资源：`pods`、`deployments`、`services`、`configmaps`、`secrets`、`nodes`、`namespaces`、`ingresses`、`jobs`、`cronjobs`、`statefulsets`、`daemonsets`、`replicasets`、`persistentvolumeclaims`、`serviceaccounts`。

| 公共能力 | 实际覆盖 | 结果 |
| --- | --- | --- |
| 输入与解析 | 命令前缀、层级遍历、选项值、`=`、引用、转义、`--`、重复/互斥选项、未知命令 | 通过 |
| IPC | 五组命令全部 189 个动态入口通过真实输入 schema；生成器前端配置不泄入 IPC | 通过 |
| 输出解析 | Git、容器名称/ID 描述、kubectl kind/name、行列表和结构化路径；去重、前缀、中文/空格/引号/特殊后缀 | 通过 |
| 路径 | 绝对/相对、`.`/`..`、`~/`、主目录未知时的父目录、隐藏项、文件/目录区别、目录级联 | 通过 |
| 查询边界 | 权限拒绝、非零退出码、取消、10 秒超时、10,000 目录项/约 2 MiB 元数据上限、最多 4,096 个路径候选、exec 输出上限 | 通过 |
| 缓存 | 128 项 LRU、TTL、1 MiB 字节预算、服务器/空间/连接/cwd 隔离；250 项结果中仍能找到第 249 项；展示最多 200 项 | 通过 |
| 键盘与鼠标 | Enter 应用、方向键边界、左右级联、Esc、Tab 透传、鼠标点击/悬停、Ctrl+C/U/W、退格、emoji 删除、整行历史命令 | 通过 |
| 异步与 TUI | 防抖取消、迟到响应、父目录改变、开关关闭、重连、配置改变、分块/同包 TUI 切换；多行输入不生成跨命令候选 | 通过 |
| 面板 | 短路径显示、来源/历史次数、多列选择、底部上翻、右侧边界、容器缩放；实际浅色、深色、900×650 窄窗口截图 | 通过 |

## 发现的问题与处理

此前的 IPC 参数泄漏及 Shell 目录钩子遗漏见[迁移修复记录](COMPLETION_FIX_2026-10-29.md)。本次扩展测试另外复现并修复：

1. Esc 后防抖或迟到响应重新打开菜单；关闭补全开关后仍保留菜单并拦截按键。
2. 完整子命令确认时没有补空格；未闭合引号内错误追加分隔空格。
3. 光标位于行中时仍按行尾 token 插入。现行中编辑暂停弹出本地候选，保留远端键盘输入，避免插坏文本。
4. 首次右键选择目录的消费结果取决于 React 状态更新时机；旧父目录响应接到新父目录；展开的 `cd` 子列未过滤文件。
5. 缓存过早截到 200 项，使后续前缀无法命中较后面的候选。现保留字节预算内的原始结果，在过滤后限制展示数量。
6. Ctrl+W 多删前一个空格；emoji 退格留下半个 UTF-16 字符；多行粘贴沿用错误的跨命令上下文。
7. 分块 TUI 控制序列漏识别，同包进入/退出被错误判为进入。
8. 历史命令被当作路径片段重新转义并追加。现保留其原有引用，替换整行且不自动执行。
9. `cwd=~` 时相对 `../` 在展开主目录前被规整为 `.`，查询到了错误目录。

这些问题有失败断言、修复后专项回归和最终 UI/协议验证。初次交互失败日志、Unicode 失败日志及路径失败日志保存在[证据目录](evidence/completion-20261029/)。

## 尚未通过的 4 项缺陷

| 编号 | 复现输入 | 预期 | 实测 |
| --- | --- | --- | --- |
| CTX-01 | `git -C /other-repo checkout fe` | 从指定仓库查询分支 | 生成的查询对象与未加 `-C` 完全相同，仍使用终端 cwd |
| CTX-02 | `docker -H tcp://fixture.invalid:2375 logs we` | 从指定 Docker 目标查询容器 | `-H` 未进入查询对象，仍使用默认目标；诊断未连接该地址 |
| CTX-03 | `kubectl --kubeconfig=/tmp/qa-config get pods we` | 使用指定 kubeconfig 查询资源 | 配置路径未进入查询对象，仍使用默认配置 |
| CTX-04 | `systemctl --user start ap` | 查询用户服务 | 用户模式未进入查询对象，仍使用系统服务查询模板 |

这 4 项是语义上下文缺口，不能以“菜单中有该选项”认定通过。它们需要将上下文从解析器传至受限后端生成器，并相应扩展固定参数 schema；本次保留为明确的待修复项，没有据此断言它们由 Rust 迁移引入。

诊断脚本：[context-audit.ts.txt](evidence/completion-20261029/context-audit.ts.txt)；真实执行日志：[context-audit.log](evidence/completion-20261029/context-audit.log)。复现方式是在临时工作区将脚本复制为 `apps/web/src/lib/completionContext.audit.test.ts`，运行 `npm run test:unit --workspace @eizhu/web -- src/lib/completionContext.audit.test.ts`，会得到 4 项失败、退出码 1。执行后删除该临时文件。

## Electron 与安装包证据

Electron 实际 xterm 场景共 **67 项**：27 个首词候选、5 组子命令菜单、9 组动态候选选择并检查实际 SSH 输入、25 个文件命令参数、1 组目录级联。全部检查候选可见且面板位于窗口内。

全部生成器另有 **11 次查询**：10 类生成器，包括 Docker 运行中/全部两种模式，通过 preload → main → utilityProcess → SSH/SFTP。远端为合成服务。

最终 DMG 重跑完整通过，`packaged=true`，67 个 UI 场景和全部生成器均通过。安装包为未签名的 `eizhu-0.5.0-test.352.049b3b3a-mac-x64.dmg`。

- 来源指纹：`9e6935680f076bf9d6f2e8ae1259a2830c9ac6e25a23bd90788b10eeb0e8b909`，构建设置与当前源码复核一致。
- DMG SHA-256：`699a942a6c643d13bc4960a6a2d3deeec27146d8a5dec119afe4f9062f4dfbfa`。
- 机器摘要：[summary.json](evidence/completion-20261029/summary.json)；安装包完整重跑日志：[package-final.log](evidence/completion-20261029/package-final.log)。
- 截图：[Docker 浅色](evidence/completion-20261029/completion-docker-light.png)、[kubectl 深色](evidence/completion-20261029/completion-kubectl-dark.png)、[npm 窄窗口](evidence/completion-20261029/completion-npm-narrow.png)、[文件候选](evidence/completion-20261029/completion-path-narrow.png)、[目录级联](evidence/completion-20261029/completion-cascade-narrow.png)。浅色菜单和目录级联截图已人工查看，文字、边界及子列目录过滤正常。

## 执行命令与原始结果

- `npm run check`、`npm run lint`、`git diff --check`。
- `npm run test:unit --workspace @eizhu/web`：870 项通过。
- 补全相关 10 个 Web 测试文件：593 项通过，包含 528 项规格矩阵、23 项输入交互及 DOM 面板、缓存、位置、历史等回归。
- `npm run test:foundation`：最终 148 项通过、1 项跳过。
- `npm run baseline:verify`、`npm run baseline:test`：固定证据校验及 10 项兼容测试通过。
- `npm run desktop:build`、`npm run desktop:smoke`：构建及完整构建输出烟测通过。
- `CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:package`，随后 `npm run desktop:smoke:package -- <本轮 DMG>`。

底层首次全套运行与 Web/编译同时进行时，`stream.test.ts` 的固定 60 ms 等待仅收到一个 32 KiB 数据包，期望是两个；停止这些并行负载后，底层全套重跑通过。该现象符合计时敏感测试的表现，未仅据此认定生产流有问题；本轮未修改该流测试。首次及最终日志均保留，最终通过不抹去首次失败记录。

最终 DMG 的首次 UI 扫描在 `bash 子` 菜单等待超时，构建输出的同组扫描此前通过。验收脚本补充了每次 Ctrl+C、输入文本到达合成 SSH 服务的确认，并在失败时记录焦点、菜单位置、最近输入和截图，再执行完整 DMG 重跑。首次日志见 [package-initial.log](evidence/completion-20261029/package-initial.log)；这是安装包烟测运行记录，单列于前述测试框架计数之外。

## 验证边界

- 本机是 macOS x64。Git、Node/npm 脚本发现、Bash、Zsh 有实际本机执行；SSH/SFTP 使用真实协议、本机回环服务和隔离目录。
- 本机没有 Docker、kubectl、systemctl、Fish。前三者使用显式 CLI 夹具及 Electron 合成响应验证参数、解析和交互，没有实际 Docker daemon、Kubernetes 集群或 Linux systemd 验收。Fish 仅完成检测/模板覆盖，实际执行跳过。
- 未连接用户真实 SSH 服务器；Windows x64、macOS arm64、Linux x64、真实 TUI/原生 IME 候选窗、长时间稳定性、签名/公证及真实更新待验。Unicode 使用 Electron 输入提交路径验证，不等同于原生输入法候选窗验收。
- 备份固定样本未修改，`admin/` 和用户运行数据不在本轮测试范围内。
