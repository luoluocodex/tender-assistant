# 宿主统一入口（P4）

`pnpm run assistant --help`。本模块装配 P1/P2/P3/P5 和读取已有快照，不重复站点或分析逻辑，不自动调用模型。P5 使用 `notify --preview/--status/--resume/--reconcile/--verify/--backup`；参数以 `notify --help` 为准。

- `cli.ts`：明确的动作与参数校验；采集、归档、分析在同一 Node 进程加载原 CLI，保留阶段的信号处理和退出码。阶段文件路径固定，不执行材料提供的程序。
- `catalog.ts`：依据快照创建时间选择指定用途的最新 P3；验证内容指纹和版本，不依赖目录修改时间，不悄悄跳过损坏文件。无正式快照不回退诊断。
- `views.ts`：验证后汇总当前公告版本、待分析队列和证据分页。队列正文完整不代表附件完整；统计是当前版本，历史版本数量单列。
- `runtime-check.ts`：当前进程环境中的异步子进程和 Windows 身份识别；`doctor --runtime-check` 额外使用 `output/playwright/tests/doctor-acl-*` 空目录验证权限，启动有头空白页并关闭，不访问网站。只删除本次创建的空目录。

`results/queue/packet` 不创建运行数据或更改分析结果；包装脚本先编译，可按 `-LogFile` 显式保存调用日志。doctor 新增 `runtime` 四项状态与 `collectionReadiness`（`not-checked/local-runtime-passed/failed`）；`ready` 还要求本次已执行检查无失败。默认不检查权限应用或浏览器；扩展检查不代表站点验证。退出 2 时仍输出完整检查 JSON。机器输出协议和恢复操作见 [P4 记录](D:/creator/coding_project/tender-assistant/docs/P4-Codex技能与统一入口.md)。测试采用本地合成快照，不修改正式数据库。
