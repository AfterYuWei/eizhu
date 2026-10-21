# 顶部 Tab 栏交付记录

日期：2026-10-21。设计依据为根目录 `DESIGN.md`，不使用 apple-design。

## 交付差异

- SSH、SFTP、密钥管理和连接草稿统一进入工作区顶部 Tab；替换原标题，不增加一行。删除左侧“已打开”、上下列表分隔条及相关布局状态，服务器分组占用剩余高度。
- 每个 SSH Tab 使用对应服务器的图标及自身的连接状态与延迟；服务器图标更新时同步变化。无测量值显示“已连接”，重连、断开及错误优先于旧延迟。保留同名编号、完整信息提示、关闭及新增入口。
- 数量过多时横向滚动，自动露出完整当前项（包含关闭按钮）；长名称按实际可用宽度截断，右侧工具栏保持可操作。支持左右方向键、Home/End 和 tablist/tab/tabpanel 关联。
- 切换时保持页面挂载。键盘切换不被终端或连接选择器抢走焦点；鼠标切换终端后恢复内容焦点。关闭仍调用原有页面释放入口，并等待异步关闭；失败时保留页面、显示错误。
- 旧偏好中的列表比例和“已打开”折叠字段不再水化或写入，保留服务器折叠及详情宽度。
- 实窗检查发现连接草稿的空服务器引用无法通过已有布局快照契约。现在仅将有服务器引用的终端写入恢复快照，保存时同步裁剪树和焦点；内存中的草稿及分屏不受影响。
- 新增独立的 Tab 窗口烟测，并接入现有 `desktop:smoke`；不新增业务 IPC、后端接口或延迟测量机制。版本、发布通道、固定证据均未改动。

## 验证证据

| 检查 | 本次结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm run lint` | 通过 |
| `npm test` | 通过：73 项基础、225 项前端、10 项固定基线测试 |
| Tab、导航、页面保留及布局专项回归 | 50 项通过，包含在完整回归中 |
| `npm run baseline:verify` | 通过，固定样本未刷新 |
| `npm run desktop:build` | 通过 |
| `npm run desktop:smoke` | macOS x64 / Electron 44.9.0 构建版通过，使用独立临时数据目录 |
| `git diff --check` | 通过 |

完整回归中的 OAuth 测试需要监听本机回环端口；首次沙箱运行因 EPERM 被拒绝，已获授权后在沙箱外重跑并全部通过。GUI 烟测同样已获授权。

后续服务器图标调整仅修改图标解析入口，已单独执行修改文件的 lint 并通过，未重复运行上述完整回归。小改动按实际影响范围做针对性验证。

Tab 专项实窗检查使用 12 个连接草稿及一个密钥页，验证真实 DOM 输入和页面节点保留、键盘焦点、关闭后的焦点恢复，以及 1280px / 900px、深浅主题、22px 字号、侧栏收起。各场景顶栏均为 48px，完整选中项和右侧按钮均位于可用区域，草稿未触发布局保存错误。

可复查产物保存在忽略的 `artifacts/` 中，运行 `npm run desktop:smoke` 可重新生成：

- [完整烟测 JSON](../../artifacts/smoke/darwin-x64.json)，包含 `workspaceTabs` 专项结果及各业务进程检查。
- [浅色、多 Tab](../../artifacts/smoke/darwin-x64/workspace-tabs-light.png)。
- [深色、900px 窗口](../../artifacts/smoke/darwin-x64/workspace-tabs-dark-narrow.png)。
- [22px 字号、侧栏收起](../../artifacts/smoke/darwin-x64/workspace-tabs-large-collapsed.png)。
- [当前构建日志](../../artifacts/smoke/workspace-tabs/build.log)、[完整回归日志](../../artifacts/smoke/workspace-tabs/tests.log)、[最终烟测日志](../../artifacts/smoke/workspace-tabs/smoke.log)。

## 验证边界与待验

- 每个 SSH Tab 的状态、不同延迟、同名编号、错误优先级和完整信息提示已通过前端回归；本次 Tab 截图使用草稿及密钥页，不能替代真实远端多连接的延迟观察。
- SSH/SFTP、数据库 Worker、KDF 和编辑器关闭协调通过现有 Electron 进程树的本机合成协议烟测；页面节点保留还通过 React 回归。未连接用户的生产服务器。
- 拖动区域验证限于实际窗口的布局及 Chromium `app-region` 计算样式；实体鼠标拖动窗口、触控板手感和屏幕阅读器仍待人工确认。
- Windows x64、Linux x64、macOS arm64 未执行；本次未重新打包、安装、签名或公证。测试辅助代码不改变生产进程架构或原生依赖。
- 用户已授权本地提交；本次不推送或发布，不改变阶段 6 其他待验项目的状态。
