# P3 JSON 字段规范

- `analysis-result.schema.json`：单份公告的模型结果，包含版本、相关性、事实/推断/缺口、逐条资格、引用和限制。
- `analysis-labels.schema.json`：人工或合成评估标签；需要审核者、包 ID、输入哈希和明确标签。
- `company-fixture.schema.json`：明确标识为合成的公司材料；不是实际公司资料入口。

源声明在 `src/analysis/contract.ts`；`pnpm run analyze:p3 --schemas` 生成以上文件。测试检查文件与运行时声明一致。仅通过 JSON Schema 还不够，导入阶段另外核验版本、引用、公司证据和完整性。

`review-labels.template.json` 中的空标签故意不满足评估要求。复制为另一个文件、由人工填写后再评估；生成模板不会覆盖人工维护的 `review-labels.json`。
