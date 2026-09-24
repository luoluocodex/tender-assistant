# P5 本地通知与手动运行

`pnpm run notify:p5 --help` 或 `pnpm run assistant notify --help`。只实现本地预览通道，明确拒绝启用外部发送或周期调度，不增加数据库或网络依赖。

| 文件 | 职责 |
|---|---|
| `model.ts`、`config.ts` | 运行时字段与同源 JSON Schema；首轮配置、重试次数和临期窗口校验 |
| `events.ts`、`deadline.ts` | 真实 P1 查询问题、P3 分析缺口、相关公告、已跟踪更新和保守临期判断 |
| `ledger.ts` | 校验、哈希、原子写入、去重标识、观察记录及状态转换历史 |
| `channel.ts` | 唯一本地文件通道、转义、内容冲突与回执核对 |
| `run.ts` | 手动运行、预写状态、取消、恢复、未知结果核对；调用方必须取得 archive 锁 |
| `report.ts`、`verify.ts` | Markdown/JSON 导出及成功回执校验 |
| `cli.ts` | 显式动作、全局锁、固定错误码、关闭调度、复用归档备份 |

模块现有 10 个 TypeScript 文件，各自小于 150 行；按独立职责拆分，无额外框架。ledger 位于 `runs/p5-notifications/ledger.json`，外层保存 schemaVersion、payload 字符串及其 SHA-256。内部字段规范见 `schemas/notification-ledger.schema.json`。记录通知预览结果，不记作外部发送成功。

状态：pending → writing → previewed / failed / unknown；上次进程留下 writing 时，恢复标 unknown，不自动重发。已知失败需要显式 resume，达到上限后仍失败并保留历史；unknown 要 reconcile，文件不符保持未知。运行报告可以重新生成，账本损坏报错而非清空重建。

当前账本 payload 为 `p5-v2`，观察项的 `material` 分别保存正文指纹、抓取时刻和附件指纹/归档序号；正文时间不变也能识别附件更新。读取 `p5-v1` 时先校验，再在内存迁移，从版本匹配且校验通过的旧 P3 包补充材料元数据；快照缺失时保留未知并保守排序。保存时写 v2，原通知 ID、回执和转换历史保留。临期判断从正文按当前字段边界重算，不沿用旧包误提取的截止时间；已生成的历史预览不自动改写。

`observations` 只是已观察版本，用于阻止旧快照回退和提示公告/附件变化，不是抓取检查点或已送达标志；通知是否处理由独立 delivery 状态决定。正式和诊断的事件、接收对象均参加去重。抓取时刻、时间窗或模型运行标识变化而业务内容相同，不重新发相关/临期事件；实际内容、分析结论或临期窗口变化产生新版本。缺口和查询问题按原查询运行记录。

测试：`pnpm test`；仅合成数据注入故障和时间，不请求政府站点，不模拟真实渠道已送达。完整口径、实测与未完成项见 [P5 执行记录](D:/creator/coding_project/tender-assistant/docs/P5-通知预览与手动试运行.md)。
