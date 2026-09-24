# JSON 字段规范

- `analysis-result.schema.json`：单份公告的模型结果，包含版本、相关性、事实/推断/缺口、逐条资格、引用和限制。
- `analysis-labels.schema.json`：人工或合成评估标签；需要审核者、包 ID、输入哈希和明确标签。
- `company-fixture.schema.json`：明确标识为合成的公司材料；不是实际公司资料入口。

源声明在 `src/analysis/contract.ts`；`pnpm run analyze:p3 --schemas` 生成以上文件。测试检查文件与运行时声明一致。仅通过 JSON Schema 还不够，导入阶段另外核验版本、引用、公司证据和完整性。

`review-labels.template.json` 中的空标签故意不满足评估要求。复制为另一个文件、由人工填写后再评估；生成模板不会覆盖人工维护的 `review-labels.json`。

P5 新增 `notification-config.schema.json`（预览配置）和 `notification-ledger.schema.json`（账本 payload、事件、回执及运行转换历史）。声明位于 `src/notify/model.ts`，生成命令 `pnpm run notify:p5 --schemas`。配置还检查已确认基线、窗口/次数上限；账本还检查 ID、回执、历史和内容哈希，不仅依赖字段形状。外层 `ledger.json` 的 payload 是 JSON 字符串，必须先验证其 SHA-256，再按此 schema 校验内部内容。

2026-09-24 的账本 payload 升为 `p5-v2`，新增 `observations[].material`（可为 null），包含正文指纹/抓取时刻与附件的内容指纹、可空归档观察。归档观察由 `archiveId / attachmentId / revision` 标识。加载器兼容 v1 并迁移到 v2 后验证，外层 schemaVersion 仍为 1，事件及回执 ID 规则不变。归档数据库 schema 2、P2 来源复核标志和观察元数据的运行时类型见 `src/archive/model.ts`、`config.ts`，完整升级边界见 [修复记录](D:/creator/coding_project/tender-assistant/docs/2026-09-24-审查缺陷修复.md)。
