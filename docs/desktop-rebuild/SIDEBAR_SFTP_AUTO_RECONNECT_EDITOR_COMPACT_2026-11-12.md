# 右侧 SFTP 自动恢复与编辑器紧凑标题栏（2026-11-12）

## 修改

- 右侧文件面板复用终端的 SSH 连接。可见面板在文件连接失效后自动重新建立详情会话；首次等待 1 秒，连续失败按 2、4、8 秒递增，最多等待 30 秒。SSH 未就绪时等待 SSH 恢复，隐藏面板或关闭最后一个所属标签后停止重试。
- 直接观察终端状态转换，避免 React 将同 ID 的断开、恢复合并渲染后漏掉重连。重新打开侧栏时读取目录以检测旧会话，重连保留当前目录、隐藏文件偏好和既有引用数量。
- 文件通道关闭或报错时及时结束目录读取，返回连接失效错误；目录权限错误仍使用普通读取错误，不触发重连。旧详情请求通过请求代次失效，不覆盖恢复后的列表。
- 编辑器顶部默认从 64px 缩至 48px，按钮统一为 30px，文件名与路径保留紧凑双行。字号放大后允许自然增高；Windows/Linux 按钮区域随高度拉伸。macOS 编辑器交通灯位置改为 `{ x: 16, y: 16 }`，中心对应距顶部 24pt。

## 已验证

- `npm run check`、`npm run lint`、`npm run desktop:build`：通过。
- 前端全量 91 个文件、1061 项通过；侧栏状态及组件专项 12 项通过。
- SSH 补全与实际回环 SSH/SFTP 协议回归 22 项通过，包括主动关闭文件子通道后返回连接失效。
- `npm run baseline:verify`：39 个固定兼容案例通过，未刷新样本。
- 本机 macOS x64 终端专项烟测：主动关闭侧栏的 SFTP 子通道，验证自动恢复 `/tmp/stage3-project` 的文件列表，终端连接仍可使用。
- 本机 macOS x64 SFTP/编辑器专项烟测：深浅主题下标题栏均为 48px；900px 窄窗口、22px 界面字号下自然增高至约 68.8px，操作按钮不遮挡，未保存内容保留。
- 使用已安装 Electron、原生模块头文件和缓存工具生成 macOS x64 测试 DMG/ZIP；DMG 提取后的终端专项及同批打包应用的 SFTP/编辑器专项均通过，报告 `packaged: true`。测试后确认项目应用停止，注销并删除 `artifacts/desktop/mac/eizhu.app`。

证据：`artifacts/smoke/darwin-x64-terminal.json`、`artifacts/smoke/darwin-x64/server-detail-auto-reconnected.png`、`artifacts/sftp-smoke/darwin-x64/report.json` 及其编辑器深浅主题截图。

## 验证边界

使用本机合成 SSH 服务、已安装工具及临时用户数据目录，不访问生产服务器。Windows、Linux、macOS arm64 和真实网络长期故障本轮未实测。macOS 测试包不签名、不公证；整套桌面烟测此前停在 AI UI 阶段，本轮使用终端与 SFTP/编辑器专项入口。
