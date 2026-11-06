# AI 供应商品牌图标补全（2026-11-06）

补齐 OpenAI、硅基流动、智谱 AI、火山方舟的单色品牌图标，11 个现有预设平台均有对应标识。聊天 Agent 选择器、设置的模型来源和平台预设共用 `serverIcons.tsx` 注册表。先按接口地址识别，再按名称识别；无法识别的自定义供应商继续使用通用图标。

新增路径取自固定版本 Lobe Icons，保留几何、填充规则及火山标识的分路径透明度，跟随界面前景色。无新增依赖，运行时不请求远程图标。来源见 [`SOURCES.md`](../../apps/web/src/assets/ai-provider-icons/SOURCES.md)，MIT 许可证随 Web 静态资源分发。

验证结果：

- `npm run check`、`npm run lint` 通过。
- AI 侧栏及设置定向测试：54 项通过；Web 回归：87 个文件、1005 项通过。
- `npm run baseline:verify`、固定兼容测试 10 项、`npm run architecture:verify` 通过。
- `npm run build --workspace @eizhu/web` 通过；构建目录包含 `licenses/lobe-icons.txt`。
- 使用已安装 Edge 检查真实图标组件：11 个品牌 × 3 种尺寸（14/16/24px）× 深浅主题，均未裁切且颜色继承正常。另验证地址优先、名称回退及自定义回退。
- 实际 `AiPanel` 组件配合隔离假配置，验证平台菜单的 11 个品牌图标、硅基流动切换后图标及原有文字标签；无运行时异常或页面远程请求。

截图和浏览器检查结果见 [`evidence/ai-provider-icons-20261106/`](evidence/ai-provider-icons-20261106/)。浏览器使用临时静态构建，预览开发服务首次优化存在自动刷新，因此最终证据采用静态 Web 预览。临时服务、浏览器及专用 profile 已清理。此轮仅变更渲染界面和本地资源，未执行 Electron 安装包或真实模型/SSH 验收。
