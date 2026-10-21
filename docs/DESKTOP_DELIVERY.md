# 桌面构建与交付

`VERSION` 是唯一基础版本源。stable 使用原值，test 自动追加 `-test` 预发布标识（实际格式 `x.y.z-test.<提交计数>.<短SHA>`）。主进程、React 与安装包共享构建配置。`out/build-info.json` 记录版本、通道、目标、提交、更新源与源码指纹，打包时逐项比对；源码、配置或提交变化后需重新构建。

```bash
npm ci
npm run check
npm run lint
npm test
npm run architecture:verify
npm run baseline:verify
npm run desktop:build
npm run desktop:smoke
npm run desktop:package
npm run desktop:smoke:package -- <安装包路径> --duration=60000
```

只在相应平台/架构的主机打包：Windows x64 NSIS；macOS 13+ x64/arm64 分架构 DMG/ZIP；Linux x64 AppImage/deb/rpm。原生模块随 Electron 分发，用户无需安装 Node。构建输出及候选包分别在 `apps/desktop/out` 和 `artifacts/desktop`。

## 独立更新源

首个 Electron 版本手动安装。开发启动及 Linux deb/rpm 提示手动安装；NSIS、macOS 和 AppImage 接入 `electron-updater`。当前尚未部署真实更新源，默认不联网检查，也不自动下载/退出安装。

构建前可设置两个独立的 HTTPS 基址：`EIZHU_UPDATE_STABLE_URL=https://<域名>/<可选前缀>/electron/stable/`、`EIZHU_UPDATE_TEST_URL=https://<域名>/<可选前缀>/electron/test/`。示例不能直接用于发布。构建追加 `<platform>-<arch>/`，从而隔离四目标；当前通道的 generic provider 写入安装包更新配置，同时生成对应元数据。跨通道检查只访问另一个明确配置的基址。拒绝认证信息、查询令牌、占位域和旧协议路径。

每个目标目录存放该目标安装资产、blockmap 和 `latest*.yml`；Windows 为 `latest.yml`，macOS 为 `latest-mac.yml`，Linux x64 为 `latest-linux.yml`。各通道目录独立，目录内统一使用 latest 清单。macOS 必须同时交付 ZIP。文件 URL 仅允许当前目录内的不可变文件名，SHA-512 必须存在；资产先上传，清单最后更新。发布时保留先前资产，禁止在相同版本文件名下替换字节。

“关于”检查后保存随机候选令牌；下载不会再次检查或替换版本。新检查、通道切换后重新检查、运行实例重启使旧令牌失效；下载/安装中拒绝并发检查。下载进度通过有 schema 和上下文的事件返回主窗口，下载器执行摘要校验。失败后必须重新检查；取消未保存文件确认可保留已校验缓存，用户可再次安装。关闭确认通过后才执行退出备份、释放业务进程/Worker 和安装重启。禁用库的退出自动安装，禁止绕开编辑器确认。安装器同步报错时保留窗口与编辑内容，不假报成功；重启应用或手动安装前先保存内容。

macOS 自动更新要求有效应用签名，hardened runtime/JIT entitlement 已保留；当前测试包不具备正式签名、公证或升级证明。Windows 签名、macOS 证书/公证配置由发布环境单独提供，私钥不入库。本轮未读取签名材料。

## 验收与回退

[CI 配置](../.github/CI.md)、[发布清单](RELEASE_CHECKLIST.md)、[最终功能矩阵](desktop-rebuild/ACCEPTANCE.md) 分别记录执行入口、正式发布门禁和已覆盖边界。只配置工作流不计为四目标执行通过。

烟测默认只运行短时合成负载；`--duration=60000` 是 60 秒，不等于 8 小时验收。`npm run desktop:stress -- --duration=28800000` 可重跑 8 小时合成负载，但仍不包含真实五路远端网络、完整备份/编辑器混合和人工交互计时。详见性能报告。

升级前导出密码加密 `.eizhubackup` 并独立保存密码。停止应用后按平台方式手动安装候选包；首次 Electron 启动只使用全新目录，不自动读取旧数据。回退时退出应用、保留新数据目录副本，再装上一版已验收安装包；不要用旧应用直接打开新数据库。需要交换业务数据时，通过备份预览后导入；UI 设置、历史、传输任务和云目标配置不在旧备份范围。

核对本机候选包和包内文件：`npm run desktop:delivery:verify -- --directory=artifacts/desktop/stage-6 --asar=artifacts/desktop/mac/eizhu.app/Contents/Resources/app.asar --report=docs/desktop-rebuild/evidence/stage-6/delivery.json`。其他平台按对应安装内容的 app.asar 路径传参。该工具验证完整构建输出、包内版本/通道，并生成源码与产物摘要，不替代启动或签名验收。

更新 API 与签名要求参考已锁定依赖源码及 [electron-builder v26 官方说明](https://www.electron.build/v26/docs/features/auto-update/)。升级依赖后须重新核对 API 和平台行为。
