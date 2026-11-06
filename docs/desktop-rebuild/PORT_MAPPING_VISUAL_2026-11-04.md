# 端口映射表单与流向预览（2026-11-04）

当前采用用户选定的“纵向接力”方案，见文末。以下按修订顺序保留既有实现与验证记录；三角形版本的截图不代表当前界面。

## 本轮调整

- 页面、表单和启动确认使用应用的字体与字号变量。修正弹窗经 Portal 挂载后继承浏览器默认字号的问题，输入框和按钮沿用既有表单的 30px 最小高度，字号放大时允许控件随内容增高。
- 三种模式的监听地址均可选择 `127.0.0.1`、`::1`、`localhost`、`0.0.0.0`、`::`，选项只显示地址。对外监听的保存前提示与启动二次确认保留。
- 本机侧目标与远端目标均提供可输入的地址选择框，常用项为 `127.0.0.1`、`::1`、`localhost`，并保留当前自定义值。仍可直接输入公网/内网 IP、IPv6 或域名；选择后焦点返回输入框。监听范围和目标地址分别控制。
- 表单右侧新增 SVG 动画。本地映射从本机流向 SSH 服务器与远端目标；远端映射从服务器反向流向本机侧目标；SOCKS5 展示服务器到多个客户端目标的分流。当前服务器、监听和目标参数即时反映在预览中，自动端口显示“自动”，IPv6 加方括号。
- 预览标注“流向示意”，不把动画当作真实连接、健康检查或业务流量。采用应用中性色与轻微底色，系统减少动态效果时关闭数据流和脉冲，静态路径保留。
- 窄窗口将预览放在字段下方，字段和预览共用可滚动区域，取消/保存按钮保留在底部。三种模式的独立草稿、保存不启动、运行独立于页面的行为不变。

## 参考与实现边界

参考 [MobaXterm 官方端口转发说明](https://blog.mobatek.net/post/ssh-tunnels-and-port-forwarding/) 的分端流向图，以及 [VanDyke 官方端口转发说明](https://www.vandyke.com/solutions/port_forwarding/index.html) 对源端与目标端的区分。字体、控件与颜色采用本仓库既有连接表单和共享 token，未引入组件库或动画依赖。

本轮仅调整前端与验收脚本，不修改 SSH 转发引擎、进程生命周期、数据库格式或备份协议。上轮 OpenSSH 30 组验收与安装产物的记录仍见 [对外映射报告](PUBLIC_PORT_MAPPING_2026-11-04.md)；旧安装包不代表本轮新界面。

## 验证记录

下表记录首版流向预览的执行结果；后续三角形布局修订的验证见文末。

| 检查 | 实际结果 |
|---|---|
| 针对性页面与 API 回归 | 19 项通过，新增目标下拉选择/自由输入/焦点恢复，以及三种预览与地址联动检查 |
| 前端完整单元测试 | 84 文件、941 项通过 |
| `npm run check`、`npm run lint` | 通过 |
| `npm run baseline:verify`、`git diff --check` | 通过，固定样本未刷新 |
| `npm run desktop:build` | macOS x64 通过 |
| `npm run desktop:smoke` | macOS x64 构建输出完整进程树通过，`packaged=false` |
| 真实渲染交互 | 本地/远端目标下拉可选，选择后输入框恢复焦点；原自定义输入与各模式草稿保留 |
| 字号与布局 | 14px 表单控件实际高度 30px；桌面两列；680px 窗口、20px 字号下切为上下布局、无横向溢出，预览可完整滚动查看，底部按钮可见 |
| 动画与可访问性 | 三种预览随类型及端点更新；通过 Chromium 媒体查询模拟验证普通动画启用、减少动态效果时关闭动画 |
| SSH 与资源回归 | 同一 Electron 隔离进程树验证三种模式 TCP 回显、实际端口复制、关闭页面保持运行、停止/删除、对外二次确认及过期确认拒绝 |
| 桌面整体回归 | 终端、SFTP、备份、账号/同步及业务进程重启通过；账号/同步使用合成服务 |

窄屏验收仅临时放宽隔离测试窗口的最小宽度，并等待重排后记录尺寸；产品窗口的最小宽度策略不变。烟测的地址选项按完整文本匹配，区分 `::` 与 `::1`。

结果见 [本轮验证摘要](evidence/port-mapping-visual-20261104/mac-x64-build.json)。截图：[本地映射](evidence/port-mapping-visual-20261104/port-mapping-form.png)、[远端映射](evidence/port-mapping-visual-20261104/port-mapping-remote-listener.png)、[SOCKS5 分流](evidence/port-mapping-visual-20261104/port-mapping-dynamic-flow.png)、[深色表单](evidence/port-mapping-visual-20261104/port-mapping-form-dark.png)、[放大字号](evidence/port-mapping-visual-20261104/port-mapping-form-large-narrow.png)、[窄屏滚动预览](evidence/port-mapping-visual-20261104/port-mapping-form-narrow-flow.png)。只保存端口映射截图及脱敏结果，不复制临时测试数据库或凭据。

本轮没有重新执行系统 OpenSSH 30 组矩阵，也没有重新打安装包；转发引擎与进程生命周期未变更，既有实际结果单独保留，不作为本轮新界面的安装验收。Windows x64、macOS arm64、Linux x64 及本轮新界面的安装产物、签名/公证仍待验。外部设备通过真实公网访问仍待用户网络条件验收，本机网卡自连不等同于公网验收。未下载测试二进制，未提交或推送。

## 三角形布局修订

按用户截图反馈，将本机与 SSH 服务器放在上方，目标居中放在下方，形成近似等边三角形排列。SOCKS5 的多个目标集中在下方，保留分流动画。本地映射由右上方服务器斜向目标，远端映射由左上方本机斜向目标；SSH 箭头继续随方向切换。

删除节点的矩形卡片及 SSH 锁图标的小底色，图标、名称、地址和动画直接呈现在预览底色上。名称和地址位于图标下方，保留外围浅底预览区域、紧凑字号、减少动态效果与窄屏布局。

旧斜线约 40°，与两个图标中心约 60° 的连线不一致，造成斜线偏斜、起点悬空的观感。当前三个图标中心为 `(72,96)`、`(312,96)`、`(192,303.85)`，三边长度近似相等；斜线沿同一条约 60° 的边裁去文字区域，本地/远端互为镜像，SOCKS5 从同一斜向主干分流。

按用户进一步反馈增加留白：表单宽度上限从 860px 调整为 960px，表单与预览列间距从 20px 增为 28px，预览内边距从 14px 增为 18px，标题/画布/说明之间增加 16px 间隔。图标中心的水平距离由 168 增至 240 个 SVG 单位，同时拉开图标与名称的距离、名称与地址的距离（基线间距由 20 增至 28），字体样式沿用当前设置。窄屏采用上下布局并自然滚动。

角度及留白调整后重新执行页面/API 针对性测试 19 项、类型检查、lint、固定基线、差异空白检查及 macOS x64 桌面构建，均通过。完整 Electron 进程树烟测通过，覆盖三种映射 TCP 回显、深浅主题、20px 字号/680px 窄屏、减少动态效果及桌面整体回归；本地和远端几何约束要求三边比例偏差小于 1%、斜线与图标中心连线的归一化叉积小于 0.01。已检查实际截图，文字未被连线遮挡，最新证据为本轮运行结果。此次未重复前端完整 941 项测试、系统 OpenSSH 矩阵或生成安装包，其他平台仍待验。

三角形版本证据：[验证摘要](evidence/port-mapping-triangle-20261104/mac-x64-build.json)、[预览局部截图](evidence/port-mapping-triangle-20261104/port-mapping-flow-detail.png)、[远端三角形预览](evidence/port-mapping-triangle-20261104/port-mapping-remote-listener.png)、[本地预览](evidence/port-mapping-triangle-20261104/port-mapping-form.png)、[SOCKS5 分流](evidence/port-mapping-triangle-20261104/port-mapping-dynamic-flow.png)、[深色](evidence/port-mapping-triangle-20261104/port-mapping-form-dark.png)、[窄屏](evidence/port-mapping-triangle-20261104/port-mapping-form-narrow-flow.png)。

## 纵向接力（当前方案）

用户比较动画方案后选择“纵向接力”。预览改为左侧竖直路径、右侧名称与地址，按实际转发顺序由上向下排列：

- 本地映射：本机监听 → SSH 服务器 → 远端目标。
- 远端映射：SSH 服务器监听 → 本机 eizhu → 本机侧目标。
- SOCKS5：本机监听 → SSH 服务器 → 客户端指定目标，下方三个目标分支依次演示。

每次接力约 4.8 秒，经过 SSH 接收节点时停留约 0.58 秒，末尾留出静止间隔。SOCKS5 每次只有一条路径出现流动短线，每 4.8 秒换一个目标，三个分支合计 14.4 秒。删除呼吸及缩放效果，图标与文字保持稳定。动画仅使用 SVG 和 CSS，不增加依赖、定时器或渲染帧回调。保留中性底色、IPv6 方括号、端口 0 的“自动”说明、长地址完整提示、参数联动和“非实时流量”标注；减少动态效果时三种模式均关闭动画并保留路径。

本轮变更限于流向组件、对应样式、既有页面回归、Electron 验收脚本和界面说明。SSH 转发引擎、IPC、数据库、备份与同步协议未修改。

本轮已通过页面/API 针对性回归 19 项、类型检查、lint、固定兼容基线、差异空白检查和 macOS x64 桌面构建。完整 Electron 进程树烟测通过：三种模式图标纵向对齐且依次向下，原生动画时间采样确认节点停留、单路径流动和末尾间隔；SOCKS5 活动分支按 0、1、2 轮换，三个分支末端偏移误差均小于 0.1 个 SVG 单位。通过 Chromium 媒体查询模拟确认三种模式减少动态效果时关闭动画。实际检查深浅主题、680px 窄窗口和 20px 字号截图，无文字/路径重叠，预览可滚动查看，底部操作保留可见。三种映射 TCP 回显、页面关闭后继续运行、停止/删除、对外二次确认，以及终端、SFTP、备份、账号/同步和 AI 桌面回归均通过；SSH、账号与同步使用本机隔离合成服务。

当前证据：[验证摘要](evidence/port-mapping-relay-20261104/mac-x64-build.json)、[本地接力局部](evidence/port-mapping-relay-20261104/port-mapping-flow-detail.png)、[远端映射](evidence/port-mapping-relay-20261104/port-mapping-remote-listener.png)、[SOCKS5 分支](evidence/port-mapping-relay-20261104/port-mapping-dynamic-flow.png)、[深色表单](evidence/port-mapping-relay-20261104/port-mapping-form-dark.png)、[窄屏滚动预览](evidence/port-mapping-relay-20261104/port-mapping-form-narrow-flow.png)。仅保留端口映射截图及脱敏摘要，不复制测试数据库或凭据。

此次未重复前端完整测试或系统 OpenSSH 30 组矩阵，未生成或测试本轮安装包，`packaged=false`。Windows x64、macOS arm64、Linux x64、签名/公证与真实外网访问仍待验。未下载测试二进制，未提交或推送。
