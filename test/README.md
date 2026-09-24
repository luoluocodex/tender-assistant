# 本地回归验证

关键词：日期边界、广东与深圳、分页、去重、失败状态、正文完整性。

运行 `pnpm test`：先构建，再使用 Node 内置测试运行器执行 `test/unit/*.test.ts` 编译后的文件。

- `window.test.ts`：跨年、北京时间、固定截止、无效或缺失日期。
- `results.test.ts`：重复采集、跨站边界、零结果、页数上限和详情抽样。
- `parsers.test.ts`：真实页面结构对应的参数规则与合成列表；金额、主体、日期、歧义和错误页。
- `content.test.ts`：使用本地合成页面和有头 Chromium，验证封闭正文读取与截断标题核对；测试结束关闭浏览器，不访问政府网站。
- `pagination.test.ts`：拦截全部请求返回合成页面，验证脚本提交式翻页到末页、HTTP 429、进度保留与停止判定；证据存放在 `output/playwright/tests/`。

测试内容明确为合成样本，不是政府采购公告。真实网站结果另存于 Git 忽略的 `output/playwright/<运行编号>/`，实测结论见 P1 执行记录。离线用例通过不能代替真实站点验证。

P2 新增 `archive.test.ts` 和 `archive-network.test.ts`；`archive-fixtures.ts` 仅构造合成 PDF/ZIP/公告。测试覆盖解析定位、损坏/加密/HTML 伪装、大小和路径边界、签名变化、幂等、版本、指纹、备份恢复、专用会话关闭重开、失效恢复、浏览器下载取消、任务取消后继续和人工文件导入。

P2 测试仅在 `output/playwright/tests/p2-synthetic-*` 中生成材料；网络场景使用 `127.0.0.1` 测试服务，不访问政府站点，不加载真实账号。实际 P2 业务材料位于源码之外的数据根目录，成绩见 P2 记录。

2026-09-24 审查修复新增 8 项回归，总计 64 项：

- `store-lock.test.ts` / `store-lock-worker.ts`：仅启动自建子进程，验证崩溃恢复、8 进程同时回收死锁标记时唯一持有者、重复释放及互斥文件保留。
- `archive-recovery.test.ts`：人工来源待复核的恢复/跨任务/备份保留，显式导入替换；A→B→A 最新观察和历史；schema 1 升级。
- `archive-notify.test.ts`：P2→P3→P5 附件刷新、旧账本迁移、去重、防回退及 A→B→A；旧分析兼容、缺失截止时间不触发假临期、schema 一致。
- `archive.test.ts` / `parsers.test.ts`：DOCX 段落/表格/超链接顺序，日期所属字段、合并标题、缺失值及多值冲突。

`skill-install.test.ts` 的包装脚本在合成项目副本中编译，只通过 node_modules 目录联接读取现有依赖，避免并行测试读写同一份项目 dist。目录联接不作为清理目标。所有新增数据仍在 `output/playwright/tests/`，不连接正式归档；测试通过不改变 P1—P6 的业务验收结论。
