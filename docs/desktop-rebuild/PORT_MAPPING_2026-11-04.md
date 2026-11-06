# SSH 端口映射交付记录（2026-11-04）

本记录描述首次回环版本；同日追加的对外监听与二次提醒见 [公网映射补充验收](PUBLIC_PORT_MAPPING_2026-11-04.md)。

## 实现

- 左侧新增“端口映射”，原终端更多菜单、命令面板及 `Ctrl/Cmd+Shift+L` 打开同一单例工作区标签。关闭标签返回此前终端或连接首页，不停止映射；SFTP 与密钥管理保持原导航行为。
- 支持本地映射、远端映射、动态 SOCKS5 TCP CONNECT。规则展示两端位置、实际监听端口、状态、连接数和重试次数，可按名称、服务器、端点、类型和状态筛选。
- 新增/编辑使用现有契约校验，监听地址通过回环枚举选择；空监听端口不会被转换成 0。保存不启动，保存失败保留输入，未保存关闭需确认。运行中先停止再编辑；删除成功后才移除规则；操作按规则互斥。
- 服务器选择读取当前空间完整列表，不受侧栏分组和搜索影响。IPv6 地址复制为 `[::1]:端口`，自动端口在启动后复制实际值。
- 页面先订阅再读取状态快照，按 `generation + revision` 合并；离开解除订阅，返回重新读取。认证/主机指纹提示独立于页面挂载，并在空间切换时重建，旧空间事件和迟到保存结果失效。

## 接口与兼容

继续使用 `tunnel.list/save/delete/start/stop/statuses`，保留已有配置 ID、字段、事件数据结构和当前空间加密 `tunnels` 存储，无数据库迁移，不进入同步或交换备份。

仅将 SSH 全局事件的 TypeScript 声明与现有运行时 schema 对齐，消除前端对隧道状态和认证事件的未检查类型断言；未增加通用 IPC、网络网关或其他后端接口。

复用原 SSH 路由及监听器，维持回环监听、独立连接、32 个活动/握手连接上限、半关闭和背压。应用重启后手动启动；关闭终端/页面不停止；退出、空间切换和业务进程关闭由既有资源所有者释放。运行中仅代表 SSH 和监听就绪，不执行目标健康探测。

## 验证

| 检查 | 实际结果 |
|---|---|
| `npm run check` | 通过 |
| `npm run lint` | 通过 |
| `npm test` | 基础测试 193 通过、1 项既有跳过；前端 929 通过；基线测试 10 通过 |
| 最新页面/表单/标签针对性回归 | 3 文件 19 项通过；覆盖后续增加的保存锁定、迟到结果及字段错误清理 |
| 最终前端全量回归 | 84 文件、931 项全部通过 |
| `npm run baseline:verify` | 通过；固定样本未修改 |
| `npm run desktop:build` | macOS x64 构建通过 |
| `npm run desktop:smoke:tunnels` | 系统 OpenSSH 实测 18 组通过 |
| `npm run desktop:smoke` | macOS x64 完整隔离进程树通过；含端口映射、SFTP、备份、账号/同步及业务进程重启回归 |

OpenSSH 脚本使用系统已安装的 sshd/ssh-keygen、临时密钥和临时配置，不修改系统 SSH 配置，结束后清理服务与密钥。18 组覆盖三种模式 × `127.0.0.1` / `::1` / `localhost` × 固定/自动端口，并逐组验证 TCP 回显、端口释放及重复停止。

Electron 新增验收通过真实页面操作走 renderer → preload → main → utilityProcess → SSH → TCP 回显，检查三种模式、实际端口复制、单例标签、关闭页面后继续转发、表单校验、保存不启动、删除，以及深浅主题和窄窗口放大字号。既有阶段 3 继续验证端口占用、认证/指纹取消、握手中停止、断线重连、SOCKS5 半包和 32 个连接上限。

烟测工具同时修正两处既有检查：密钥列表按当前无框设计检查 0 圆角；工作区标签只查询工作区头部，不把复用标签样式的 SFTP 内部连接计入，并用当前关闭按钮选择器释放 SFTP 测试连接。

## 证据与待验

本次证据目录：[验证摘要](evidence/port-mapping-20261104/validation.json)、[Electron 构建输出](evidence/port-mapping-20261104/mac-x64-build.json)、[真实 OpenSSH 18 组结果](evidence/port-mapping-20261104/darwin-x64-openssh.json)。只保留端口映射相关结果及界面截图，不复制账号会话、密钥或临时测试数据库。

界面截图：[浅色](evidence/port-mapping-20261104/port-mapping-light.png)、[深色](evidence/port-mapping-20261104/port-mapping-dark.png)、[窄窗口与放大字号](evidence/port-mapping-20261104/port-mapping-large-narrow.png)、[规则表单](evidence/port-mapping-20261104/port-mapping-form.png)。

- macOS x64：本机构建输出与系统 OpenSSH；最终安装包本轮未重新打包验收，生产进程及原生模块实现未修改。
- Windows x64、macOS arm64、Linux x64：本轮未执行，列为待验。
- 外部真实服务器、实际 Agent/MFA、重试耗尽完整计时、长时间运行、签名/公证：本轮未新增执行证据，不以合成服务或本机 OpenSSH 代替。
- 仅本机回环、TCP、手动启动；不包含公网监听、UDP、NAT/防火墙修改、自动启动或后台常驻服务。
