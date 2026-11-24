# 自动备份与第三方云存储

在「设置 → 数据备份 → 自动备份」选择本地目录，并设置至少 6 位的备份密码。每次生成一个独立的密码加密 `.eizhubackup` v1 文件，再将同一文件上传到启用的第三方云目标。原有云端文件保留。[精简交付记录](desktop-rebuild/BACKUP_SIMPLIFICATION_2026-11-01.md)

可立即备份，也可按数据变更、间隔、每日时间或正常退出触发。文件包含分组、凭据、服务器和命令片段，密码修改后，已有文件继续使用生成时的密码。文件由用户在本地目录或第三方存储中管理。

## 目标

- WebDAV：填写现有父目录 HTTP(S) 地址、用户名及密码，客户端在其下创建本设备独立目录。使用 Basic 认证；在公网应使用 HTTPS。重定向不自动跟随，避免凭据转发。
- S3 兼容存储：填写存储桶、区域、Access Key、Secret Key，可选 endpoint、prefix 和 path style。请求以 AWS Signature v4 签名。对象位于 `prefix/spaces/` 下的独立空间目录。
- Google Drive：使用 Google Cloud Console 的**桌面应用** OAuth 凭据；授权范围为 `drive.file`，只操作应用创建的独立设备目录。通过系统浏览器授权。
- OneDrive：在 Azure 注册原生桌面应用，按 Microsoft 的回环地址规则，在应用清单登记 `http://127.0.0.1/oauth/onedrive`；运行时使用临时端口。范围为 `Files.ReadWrite offline_access`。使用独立设备目录。

OAuth 使用 PKCE S256、随机 state、5 分钟有效期和一次性回调；监听仅绑定 `127.0.0.1` 的临时端口。固定路径由 state 和 Host 检查保护。目标变化、取消、超时或运行实例结束会关闭监听；不提供本地业务 HTTP 网关。刷新令牌在业务层按目标串行化，更新前检查目标修订。

## 确认与恢复

上传完成后，应用读回刚上传的文件校验摘要。云目标上传失败时，本地文件仍可使用，详情见备份状态。

恢复时找到本地文件，或从第三方存储下载文件，再进入「文件导入与导出」选择文件和输入备份密码。预览会显示条目和冲突数量，按所选策略导入。覆盖前如需保留当前条目，请先手动导出加密文件。[文件导入与导出](BACKUP.md)

协议依据：[AWS SigV4](https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html)、[S3 条件写](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)、[Google 桌面 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、[Microsoft 回环回调规则](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)。具体实测范围见阶段 5 报告。
