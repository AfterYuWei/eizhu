# 固定兼容样本

本目录只含合成测试数据。固定密码、派生密钥和私钥都是公开的测试常量，不来自用户账户；所有服务器均位于example.invalid，未进行网络连接。

来源、限制和生成方法见 [重建交付记录](../../../docs/desktop-rebuild/README.md) 与 [兼容契约](../../../docs/desktop-rebuild/COMPATIBILITY.md)。

正常检查使用 `npm run baseline:verify`、`npm run baseline:test`，不会改写本目录。不要在CI里执行capture来更新预期结果。原Rust参考代码仅在cfg(test)编译，创建临时数据库，进入新工程后可以删除；本目录及Node校验继续保留。

manifest.json冻结当前源提交与资产摘要；其中userApproved=false表示采集时尚未审阅，后续用户确认记录在交付报告，不能为了批准而改写固定样本。
