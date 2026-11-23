# 品牌图标更新 · 2026-11-12

采用第 6 款立体折带：白底、石墨色 Z 形上下折面与浅灰色斜向连接面。将概念稿整理为矢量轮廓，保留折带的比例与层次，修正边缘、对齐及透明外缘，保持简洁的中性配色。

## 资源与重建

- `apps/web/public/eizhu-logo.svg`：唯一字标轮廓源，三个折面共用 `currentColor`，斜面使用透明度区分层次。
- `apps/web/public/favicon.svg`：同一轮廓，按系统深浅主题显示黑色或白色。
- `apps/desktop/resources/icon.svg`：白色圆角底板、透明外部留白的完整应用图标。
- `brand.png`、`128x128.png`、`256x256.png`：同一矢量按目标尺寸直接渲染的 RGBA 图像。
- `icon.ico`：16、24、32、48、64、128、256px 共 7 个无损 PNG 图像。
- `icon.icns`：标准及 Retina 共 11 个尺寸变体，最大 1024px。

运行 `npm run icons:generate`，使用已安装的 Electron 在隔离临时目录中渲染并重新生成资源，无需额外下载工具。该操作需要桌面图形环境。现有打包配置与窗口图标引用继续使用原路径。

架构检查由“与旧图标字节完全相同”调整为新图标的尺寸、容器、跨格式 PNG 字节一致性及 SVG 字标一致性校验。未改动 `tests/fixtures/desktop-baseline` 的固定证据及其独立校验。

## 验证

- `npm run check`、`npm run lint`：通过。
- `npm run baseline:verify`、`npm run baseline:test`：通过，固定兼容回归 10 项。
- `npm run architecture:verify`：通过，验证 8 个品牌资源、7 个 ICO 尺寸和 11 个 ICNS 变体。
- `npm run desktop:build`：通过；构建沿用现有的 `inlineDynamicImports` 弃用提示。
- `iconutil -c iconset`：macOS 系统工具成功解码 ICNS；`file` 正确识别 ICO 和 ICNS。
- 已目视检查 1024px 与 128px PNG，透明外缘、折面轮廓及深浅层次清晰。
- Prettier 检查与 `git diff --check`：通过。

本次未重新打包安装，未验证 Windows/Linux 实机及系统图标缓存刷新。已安装应用将在使用新资源重新打包安装后更新图标；应用版本、标识及更新通道保持原值。未发布新版本。
