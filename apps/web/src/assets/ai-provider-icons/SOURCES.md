# AI 供应商品牌图标来源

补充现有 Simple Icons 未提供的品牌标识，使用 [Lobe Icons](https://github.com/lobehub/lobe-icons) 的单色 SVG 路径。
固定来源版本：`ea434b96e75813517b377825e01c0df61dee8836`。获取日期：2026-11-06。

| 本地标识 | 来源 |
| --- | --- |
| OpenAI | [openai.svg](https://github.com/lobehub/lobe-icons/blob/ea434b96e75813517b377825e01c0df61dee8836/packages/static-svg/icons/openai.svg) |
| 硅基流动 | [siliconcloud.svg](https://github.com/lobehub/lobe-icons/blob/ea434b96e75813517b377825e01c0df61dee8836/packages/static-svg/icons/siliconcloud.svg) |
| 智谱 AI | [zhipu.svg](https://github.com/lobehub/lobe-icons/blob/ea434b96e75813517b377825e01c0df61dee8836/packages/static-svg/icons/zhipu.svg) |
| 火山方舟 | [volcengine.svg](https://github.com/lobehub/lobe-icons/blob/ea434b96e75813517b377825e01c0df61dee8836/packages/static-svg/icons/volcengine.svg) |

`index.ts` 保留上游路径几何、24×24 视口、evenodd 填充规则和火山图标的分路径透明度。
通过 `serverIcons.tsx` 注册，使用 `currentColor` 跟随界面主题；不从网络加载图标，不引入额外依赖。
原有品牌继续使用已安装的 Simple Icons。自定义且无法识别的供应商保留通用图标。

Lobe Icons 代码使用 MIT 许可证，原文见 [`public/licenses/lobe-icons.txt`](../../../public/licenses/lobe-icons.txt)，构建时随渲染资源分发。产品名、商标及品牌标识归各自权利人所有，仅用于识别供应商。
