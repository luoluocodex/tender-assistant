# P3 规则、证据和会话分析

本模块只消费 P1 报告及显式指定的 P2 归档任务，不访问网站。入口为 `pnpm run analyze:p3 --help`，完整操作见 [P3 执行记录](D:/creator/coding_project/tender-assistant/docs/P3-过滤去重与AI分析.md)。

| 文件 | 职责 |
|---|---|
| `source.ts` | 输入校验、P1 正文哈希、P2 内容校验、公开链接及敏感参数处理 |
| `fields.ts` | 补充多行项目编号、合同甲方与合同金额；原文和歧义保留 |
| `rules.ts` | 时间/地区/排除词、阶段分类、项目关联、标包范围和版本状态 |
| `packets.ts` | 证据分块、提示词/规则/公司版本绑定、完整性标识 |
| `contract.ts` | 严格字段校验及同源 JSON Schema；无新增依赖 |
| `validation.ts` | 逐字引文、版本、公司证据与保守降级 |
| `persistence.ts` | 受限目录中的快照、模型结果历史、幂等和损坏检测 |
| `report.ts` | JSON/CSV/Markdown、人工标注模板、评估分母与错误样例 |
| `cli.ts` | 显式参数、全局归档锁、增量输入与错误处理 |
| `model.ts` | 内部跨模块类型 |

确定性规则不伪装为 AI。`--prepare` 生成完整证据包，当前 Codex 会话按 `prompts/` 分析，再用 `--import` 校验导入；程序不自动启动模型或调用 API。`modelStatus=pending` 明确表示尚未分析。`--company-fixture` 只接受标为 synthetic 的测试资料，真实公司材料入口未启用。

默认资料缺失、正文或附件不全时保留复核；有引用也不能证明语义判断正确。CSV 防止网页标题被解释为公式，Markdown 对材料中的格式字符转义。网页和附件中的指令不能扩大权限。

`pnpm test` 中 P3 的 12 项测试覆盖解析边界、引用拒绝、版本变化、合成资质、CLI 失败、恢复和评估。不包含政府网站的新请求，也不代表真实人工标注指标达标。
