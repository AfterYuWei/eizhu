# SFTP 与密钥管理单实例页面验收

日期：2026-10-21。范围为当前工作空间内的工具页面导航与生命周期。

## 交付行为

- SFTP、密钥管理各一个功能页面，首次进入后保持挂载；重复进入复用页面和状态，不新增工作区标签。
- 顶部只保留终端与连接草稿。进入工具页时终端标签全部取消选中，点击或键盘切换终端标签可返回原终端。
- SFTP 内部双栏、服务器标签、多连接、文件选择和传输队列保留。侧栏和首页只导航；从终端触发 SFTP 操作时复用右栏服务器连接并定位目录。
- 工具页隐藏分屏、详情和关闭操作；关闭、重连、查找及分屏快捷键不操作后台终端。显式点击后台终端标签的关闭按钮仍可关闭该终端。
- 旧空间工具状态显式重置；SFTP 释放幂等并等待现有会话及尚未完成的连接创建。旧空间异步定位不能打开新空间连接。

## 差异清单

- 新增工作空间页面状态与内容容器，统一侧栏、首页、命令搜索及快捷键入口；终端会话列表只管理终端。
- 删除工具标签类型、`openSftpTab` / `openVaultTab`、终端容器中的工具渲染分支，以及工具标签图标、编号和关闭分支。
- 删除 `fileOwners.ts`、SFTP 隐式备用 store、未使用的底部 StatusBar 组件及其专用样式；移除对应旧测试与选择器。
- SFTP 连接中重复打开同一个内部标签时复用连接请求；显式定位按顺序处理，过期定位不覆盖新请求。服务器选择器打开时刷新可用配置。
- 更新 `DESIGN.md`。领域 DTO、preload、后端协议、数据库及备份格式均无变更；主进程变动仅为更新烟测断言。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm run lint` | 通过 |
| `npm test` | 73 项基础测试、232 项前端测试、10 项固定兼容测试全部通过 |
| `npm run baseline:verify` | 通过，固定资产未刷新 |
| `npm run architecture:verify` | 通过 |
| `npm run desktop:build` | 通过 |
| `npm run desktop:smoke` | macOS x64 构建输出烟测通过 |
| `git diff --check` | 通过 |

新增与更新的回归覆盖单实例复用、无终端打开工具页、首次按需挂载、切换保留 DOM/输入/队列、终端键盘切换与分屏、后台标签关闭、工具页快捷键隔离、重复连接去重、释放等待和旧空间响应失效。

实际 Electron 烟测使用独立临时数据目录与本地合成 SSH/OpenSSH SFTP 服务：

- 12 个终端草稿打开密钥页后，顶部标签仍为 12 个且均不选中；重复进入保持同一 DOM；关闭快捷键不减少终端标签。
- SFTP → 密钥管理 → SFTP 保持同一个页面节点，前后服务器会话 ID 集合一致，顶部没有 SFTP 标签。
- 使用 SFTP 页面所属连接开始上传，在上传尚未完成时切换工具页；返回后继续分块写入并提交，任务完成且文件内容与预期一致。
- 深浅主题、900px 窄窗口、22px 字号和折叠侧栏的既有终端导航烟测通过；检查了本轮密钥页深浅主题及 SFTP 截图。

首次烟测因新增测试把无参 `sftp.listSessions()` 误传空对象而中断；修正测试调用后重建，完整重跑通过。

## 证据与边界

- [macOS x64 完整构建烟测报告](evidence/tools-singleton/mac-x64-build-smoke.json)：`workspaceTabs.singletonTools`、`toolShortcutIsolation` 和 `stage4.singletonPage`、`navigationRetainsConnections`、`navigationRetainsTransfer` 均为 true。
- [SFTP 截图](evidence/tools-singleton/mac-x64-sftp.png)、[密钥页浅色](evidence/tools-singleton/mac-x64-vault-light.png)、[密钥页深色](evidence/tools-singleton/mac-x64-vault-dark.png)；文件摘要见 [sha256.json](evidence/tools-singleton/sha256.json)。
- 本轮实际执行平台为 macOS x64 的构建输出。Windows x64、macOS arm64、Linux x64 及最终安装包未复验；本地合成服务结果不代替真实远端与长期传输验收。
- 官方账号、账号同步及官方云备份仍按已有阶段约定延后。
