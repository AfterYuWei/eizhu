# 阶段 1 证据索引

- `review-status.json`：当前源码输入摘要、先前产物摘要、测试来源、平台状态与阻塞原因。
- `mac-x64-previous-package-smoke.json`：2026-10-20 11:48（UTC+8）先前 DMG 内容烟测结果，已替换本机临时目录地址。它早于当前源码，不能作为最终验证。
- `mac-x64-package-smoke.json` 与 `mac-x64-*.png`：2026-10-20 15:03（UTC+8）最新最终 DMG 烟测及三张真实截图；Luna 独立执行，退出码 0。
- `lifecycle-check.txt`：Luna 对新增进程关闭用例的 6 项专项测试及受影响代码检查的结果。

此前 221 项通过结果来源于本会话执行记录，原始临时日志未留存；Luna 独立补验没有重复运行这些测试。先前三张烟测图片不可取回，未伪造或重新生成替代旧证据。

烟测把图片保存到 `artifacts/smoke/<platform>-<arch>/`，报告保存到 `artifacts/smoke/<platform>-<arch>.json`；CI 将二者归档。本目录已保存最新 macOS x64 包的结果；其余目标待远端 CI。
