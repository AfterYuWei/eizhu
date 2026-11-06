# Bash SSH 提示符钩子分隔修复

日期：2026-11-02。本轮修改源码并完成本机定向验证，未打包或发布。

## 问题与修复

用户反馈 Debian SSH 登录后，每次提示符显示都会报错：

```text
syntax error near unexpected token `;'
history -a; ;__eizhu_osc7
```

服务器原有 `PROMPT_COMMAND` 为 `history -a; `，客户端再用分号追加会话钩子，导致出现两个连续的命令分隔符。本机使用同样的原值复现了该错误。

- `packages/core/src/ssh/shell.ts`：字符串形式的 `PROMPT_COMMAND` 改用换行追加目录/提示符钩子，原有内容保持不变；保留数组处理，并识别重复安装和既有分号形式钩子。
- `packages/core/src/ssh/shell.test.ts`：增加 9 个字符串用例，覆盖空值、普通命令、尾部分号及空格、`history -a; `、注释、后台命令、换行和既有钩子；验证重复安装后只有一个钩子，且实际执行能发出目录标记。交互式 Bash 用例也改为尾随分号，并检查无语法错误。

注入仍仅作用于 SSH 会话，不修改服务器 Shell 配置文件。修复后的客户端需要重新建立 SSH 会话才能使用新注入逻辑。

当前受影响会话可执行以下命令恢复用户日志中展示的历史保存和目录钩子：

```bash
PROMPT_COMMAND=$'history -a\n__eizhu_osc7'
```

## 验证

| 检查 | 结果 |
| --- | --- |
| Shell 定向测试 | 18 项通过，1 项 Fish 因未安装而跳过；修复前新增用例中的 6 项失败，包含用户原始配置 |
| SSH/SFTP、连接诊断、终端流及 SSH 契约回归 | 53 项通过、1 项 Fish 跳过；SSH/SFTP 使用本机临时服务及隔离 CLI fixtures |
| Web 终端高亮回归 | 10 项通过 |
| `npm run check` | Node 与 Web 类型检查通过 |
| 两个变更 TypeScript 文件的 ESLint | 通过 |
| `npm run baseline:verify` | 固定 39 个用例、37 个资产及旧备份/协议证据通过，未刷新样本 |
| `npm run desktop:build` | macOS x64 构建通过 |
| `git diff --check` | 通过 |

SSH 集成测试首次因沙箱禁止监听 `127.0.0.1` 返回 `EPERM`，获得本地测试执行授权后重跑通过。本机真实 Shell 为 Bash 3.2 与 Zsh 5.9；未下载测试二进制。Bash 4.4+、用户的 Debian 服务器、其他桌面平台及最终安装包未在本轮实际验收。
