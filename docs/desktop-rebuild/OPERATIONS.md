# 桌面截图与操作基线

10张截图来自当前未修改的React渲染器，1280×720，界面14px、默认侧栏300px，无用户服务器或凭据。
通过正常界面点击采集，没有注入假原生API。文件由截图工具原样返回JPEG，没有二次绘制或图片编辑。

具体场景、主题、步骤、关联验收编号和环境缺口见 [screenshots.json](../../tests/fixtures/desktop-baseline/screenshots.json)。

| 场景 | 截图 |
|---|---|
| 浅色首页 | [home-light](../../tests/fixtures/desktop-baseline/screenshots/home-light.jpg) |
| 收起侧栏 | [home-collapsed](../../tests/fixtures/desktop-baseline/screenshots/home-collapsed.jpg) |
| 全局搜索 | [search-empty](../../tests/fixtures/desktop-baseline/screenshots/search-empty.jpg) |
| 新建连接 | [profile-create](../../tests/fixtures/desktop-baseline/screenshots/profile-create.jpg) |
| 账号菜单 | [account-menu](../../tests/fixtures/desktop-baseline/screenshots/account-menu.jpg) |
| 浅色设置 | [settings-appearance-light](../../tests/fixtures/desktop-baseline/screenshots/settings-appearance-light.jpg) |
| 深色设置 | [settings-appearance-dark](../../tests/fixtures/desktop-baseline/screenshots/settings-appearance-dark.jpg) |
| 深色首页 | [home-dark](../../tests/fixtures/desktop-baseline/screenshots/home-dark.jpg) |
| 浏览器凭据加载失败 | [vault-browser-unavailable](../../tests/fixtures/desktop-baseline/screenshots/vault-browser-unavailable.jpg) |
| 密钥生成初始表单 | [vault-keygen](../../tests/fixtures/desktop-baseline/screenshots/vault-keygen.jpg) |

## 已核对的操作

1. 首页→折叠侧栏→搜索→Escape，搜索关闭并恢复入口焦点。
2. 展开侧栏→新增第一台服务器→取消，表单包含现有密码、代理、分组和连接测试入口。
3. 头像→设置，打开完整窗口设置页而非居中Dialog。
4. 外观→深色→返回应用，主题和导航保持一致；只修改临时浏览器页的设置。
5. 密钥管理→生成密钥对→关闭，空名称时生成按钮禁用，现有算法和Passphrase入口保留。

账号菜单当前显示“开发中”，这是现有UI基线。完整账号/云端能力仍需在新业务层保留，不借重建新增或重排账号界面。

## 原生与连接状态缺口

浏览器没有Tauri IPC，因此搜索中的凭据不可用提示、凭据页加载失败均标为环境状态，不能复刻成Electron正常行为。

下列项目仍须在各阶段使用隔离的真实环境补充，不将空数据浏览器截图当作完成证据：

- macOS原生按钮及全屏，Windows/Linux窗口控件、拖动、缩放、X11/Wayland。
- 连接后终端、四窗格、TUI/IME、补全、详情，以及填充数据的SFTP、传输和冲突状态。
- 原生独立编辑器、多脏标签、文件比较、关闭和账号切换协调。
- 系统文件选择、拖入拖出、剪贴板、系统密钥库、OAuth、真实同步和安装更新。

当前macOS不可见AppKit几何测试覆盖正常/紧凑控件、900×600/1440×900/1920×1080、重复布局和32pt中心线；这是几何证据，仍不替代原生窗口实际拖动或全屏。

每个后续阶段复核同一场景下的布局、尺寸、颜色、文案、入口、焦点和键盘操作。新的可见差异必须记录，不能通过替换基线图片消除差异。
