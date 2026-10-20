# 阶段 1 证据索引

- `review-status.json`：当前源码输入摘要、先前产物摘要、测试来源、平台状态与阻塞原因。
- `mac-x64-previous-package-smoke.json`：2026-10-20 11:48（UTC+8）先前 DMG 内容烟测结果，已替换本机临时目录地址。它早于当前源码，不能作为最终验证。
- `mac-x64-package-smoke.json` 与 `mac-x64-*.png`：最新本机最终 DMG 烟测及三张真实截图；Luna 独立执行，退出码 0。时间和构建范围见 JSON。
- `lifecycle-check.txt`：Luna 对新增进程关闭用例的 6 项专项测试及受影响代码检查的结果。
- `fixture-byte-check.txt`：强制 autocrlf 后四类固定样本保持原字节的专项检查；第二轮 Windows CI 固定样本检查亦已通过。
- `ci-run-39384397849.json`：首轮远端四目标 CI 的失败矩阵，详细日志现已读取。
- `ci-first-run-causes.txt`：登录后读取的首轮日志原因、字节核对及修正依据。
- `native-setup-check.txt`：原生安装流程修正后的脚本检查、原生重建、macOS x64 重打包与最终 DMG 烟测；本机缓存及 Linux 待验边界单列。
- `ci-retry-ddaa417.json`：第二轮远端结果；macOS x64 最终包烟测通过，其余三目标的失败步骤与原因。

- `smoke-fixes-check.txt`：语言注册等待 3 项测试、受影响静态检查、本机重打包与最终 DMG 烟测；Windows/Linux 远端待验。

此前 221 项通过结果来源于本会话执行记录，原始临时日志未留存；Luna 独立补验没有重复运行这些测试。先前三张烟测图片不可取回，未伪造或重新生成替代旧证据。

烟测把图片保存到 `artifacts/smoke/<platform>-<arch>/`，报告保存到 `artifacts/smoke/<platform>-<arch>.json`；CI 将二者归档。本目录已保存最新本机 macOS x64 包的结果；远端第二轮 macOS x64 最终 DMG 烟测已通过，其余三目标修正等待复验。
