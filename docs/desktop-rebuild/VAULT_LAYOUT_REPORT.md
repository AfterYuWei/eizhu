# 密钥管理列表与详情布局

日期：2026-10-22。按已确认的预览调整密钥页面，沿用设置页的圆角、分组底色、弱边界和留白。

## 交付行为

- 左侧紧凑凭据列表，右侧显示详情；取消顶部、左右栏及内容之间的贯穿分割线。分组采用 12px 圆角，默认栏间距为 28px，窄内容区改为上下布局。
- 新建与编辑在右侧完成，保留密码生成、密钥导入导出及安装公钥命令。未保存时取消、切换凭据或筛选会先确认；保存后选中该凭据，必要时清除筛选使其可见。
- 列表只读取摘要。详情中的密码、私钥、公钥与口令默认隐藏，显示或复制时才读取；隐藏、切换条目或离开密钥页面会清理显示状态，过期读取响应不能重新显示旧内容。
- 复制使用现有主进程敏感剪贴板能力，30 秒后清理且不覆盖用户后续复制。关联连接按需展开，删除前重新查询引用；读取原凭据失败时禁止提交，重试成功后才允许编辑。

## 差异清单

- `VaultView`、`VaultList`、`VaultItemRow` 与新增的 `VaultDetail` 负责列表选择、详情和行内编辑。
- `VaultFormDialog` 提取可复用表单，增加读取失败重试、字段标签与编辑状态回传；保留对话框导出接口。
- `vault.css` 增加桌面页面作用域样式，使用已有表面、字号、主题和圆角 token；`DESIGN.md` 记录已确认的布局。
- 新增 6 项前端回归与隔离数据目录的桌面界面烟测。主进程改动仅为烟测代码；领域 DTO、preload、业务协议、数据库、原生依赖及备份格式没有变更。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm run lint` | 通过 |
| `npm test` | 73 项基础测试、266 项前端测试、10 项固定兼容测试全部通过 |
| `npm run baseline:verify` | 通过，固定资产未刷新 |
| `npm run desktop:build` | 通过 |
| `npm run desktop:smoke` | macOS x64 最终构建输出烟测通过 |
| `git diff --check` | 通过 |

前端回归覆盖按需读取、敏感复制、隐藏及离页清理、过期读取丢弃、引用懒加载、编辑确认、原内容保留、读取失败重试、重新新建时重置表单和筛选期间新建后定位。完整回归中的 OAuth 测试需要本机回环监听权限；取得权限后已重跑通过。

实际 Electron 使用隔离临时数据目录和合成凭据，验证显示/隐藏、复制、引用展开、引用保护、未引用凭据删除、行内编辑确认及保存。布局断言确认 12px 圆角、28px 栏间距、顶部无分割线且工具栏可用；浅色、深色及 1000px 窗口的 20px 字号均检查了截图。最终构建首次整轮运行在既有阶段 5 的备份设置提示断言失败，密钥与工作区检查已通过；相同构建不修改源码复跑后整轮通过，保留两次日志。

## 证据与边界

- [检查日志](evidence/vault-layout/checks.log)、[构建配置与源码摘要](evidence/vault-layout/build-info.json)、[macOS x64 构建烟测报告](evidence/vault-layout/mac-x64-build-smoke.json)。构建配置中的 revision 为提交前的父提交，sourceDigest 标识实际验证的源码工作区。
- 桌面烟测日志：[首次运行](evidence/vault-layout/smoke-first-attempt.log)、[最终通过运行](evidence/vault-layout/smoke-final.log)。
- 实际桌面截图：[浅色](evidence/vault-layout/vault-layout-light.png)、[深色](evidence/vault-layout/vault-layout-dark.png)、[1000px 窗口与 20px 字号](evidence/vault-layout/vault-layout-large-narrow.png)。凭据始终隐藏；文件摘要见 [sha256.json](evidence/vault-layout/sha256.json)。
- 本轮不变更应用关闭或空间切换协议；未保存确认的新增覆盖范围为密钥页面内的取消、条目和筛选切换。
- 本轮不涉及进程或原生模块行为变更，未复验最终安装包。Windows x64、macOS arm64、Linux x64、签名、公证及真实更新也未在本轮复验。
- 官方账号、账号同步及官方云备份继续延后。
