# JSON 字段规范

2026-09-28 包装器修订：`-LogFile` 中 `stream=stdout|stderr` 的 `text` 固定为 `captured`，新增 `charCount`，不再包含原始双流。`stream=status` 使用固定状态 `started/finished/needs-human/failed-see-error-file`；不复制 URL、错误原文或模型材料。`-OutputFile` 支持阶段动作各退出码的完整 stdout（多行 JSON 或文本）；只读 JSON 动作保持下面的成功/doctor 退出 2 约定。新增 `-ErrorFile` 保存完整 stderr、编译失败 stdout 和包装器异常。两类结果文件以当前用户/SYSTEM ACL 创建，均为 UTF-8，拒绝覆盖。文件存在不代表成功，必须核对本次最终退出码；启动前失败可能没有业务输出，错误文件可以为空。日志 schema 的 `timestamp/stage/stream/text/exitCode` 字段保留，但消费者不能再把 `text` 当原始业务输出。

`packet` 每页增加 `rules={version,keyword,region,excludeKeywords}`，来自该包快照，`ruleVersion` 保持兼容。第一页仍提供原快照 `prompts`，其他页为 null；旧输入哈希与提示词不重写。业务范围读取包内规则，不读取当前配置替换旧任务范围。

P4 诊断契约（2026-09-24）：doctor 在 schemaVersion=1 下增加 `runtime.subprocess/windowsIdentity/directoryPermissions/browser`，每项 `status=passed|failed|not-checked|not-applicable`，失败可附 `message`。`collectionReadiness=not-checked|local-runtime-passed|failed` 表示是否执行并通过扩展检查；`ready` 仅针对本次已执行检查。`--runtime-check` 不验证网站或账号。包装器 `-LogFile` 为 UTF-8 JSONL，每行含 `timestamp/stage/stream/text`，完成记录附 `exitCode`；最后 `stage=wrapper, stream=status, text=finished` 才是完整命令结束记录。doctor 退出 2 仍可生成 `-OutputFile` 失败检查 JSON。字段说明及调用边界见[故障修复记录](../docs/2026-09-24-WorkBuddy采集故障修复.md)。

P1 查询天数契约（2026-09-24）：CLI `collect --days N` 接收 1～90 的整数；未给值时读取 `config/p0-baseline.json.dateRange.days`，默认值同样校验。内部 `RunConfig.days` 为必填 number，`createWindow(now, days)` 不再内置默认天数。新 P1 `report.json.queryDays` 记录本次天数，`window` 保留起止日期、截止时刻和时区；旧报告未添加此字段，P3 仍按原 `window` 消费，不重写历史数据。超限报 `QUERY_DAYS_EXCEEDED`，非正整数报 `INVALID_QUERY_DAYS`，退出码均为 1；缺值或未知参数由 CLI 参数解析器拒绝，均不创建采集任务。

- `analysis-result.schema.json`：单份公告的模型结果，包含版本、相关性、事实/推断/缺口、逐条资格、引用和限制。
- `analysis-labels.schema.json`：人工或合成评估标签；需要审核者、包 ID、输入哈希和明确标签。
- `company-fixture.schema.json`：明确标识为合成的公司材料；不是实际公司资料入口。

源声明在 `src/analysis/contract.ts`；`pnpm run analyze:p3 --schemas` 生成以上文件。测试检查文件与运行时声明一致。仅通过 JSON Schema 还不够，导入阶段另外核验版本、引用、公司证据和完整性。

`review-labels.template.json` 中的空标签故意不满足评估要求。复制为另一个文件、由人工填写后再评估；生成模板不会覆盖人工维护的 `review-labels.json`。

P5 新增 `notification-config.schema.json`（预览配置）和 `notification-ledger.schema.json`（账本 payload、事件、回执及运行转换历史）。声明位于 `src/notify/model.ts`，生成命令 `pnpm run notify:p5 --schemas`。配置还检查已确认基线、窗口/次数上限；账本还检查 ID、回执、历史和内容哈希，不仅依赖字段形状。外层 `ledger.json` 的 payload 是 JSON 字符串，必须先验证其 SHA-256，再按此 schema 校验内部内容。

2026-09-24 的账本 payload 升为 `p5-v2`，新增 `observations[].material`（可为 null），包含正文指纹/抓取时刻与附件的内容指纹、可空归档观察。归档观察由 `archiveId / attachmentId / revision` 标识。加载器兼容 v1 并迁移到 v2 后验证，外层 schemaVersion 仍为 1，事件及回执 ID 规则不变。归档数据库 schema 2、P2 来源复核标志和观察元数据的运行时类型见 `src/archive/model.ts`、`config.ts`，完整升级边界见 [修复记录](D:/creator/coding_project/tender-assistant/docs/2026-09-24-审查缺陷修复.md)。
