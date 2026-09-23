# P4：Codex 技能与统一入口

执行日期：2026-09-23。任务类型：宿主集成、使用文档与测试。项目：`D:\creator\coding_project\tender-assistant`。

## 1. 结果与验收范围

已实现并安装 Codex「招投标助手」技能，统一调用现有 P1 采集、P2 归档、P3 分析程序，增加已有清单、待分析队列和证据分页入口。当前 Codex 会话显式读取安装后的技能，从另一工作目录完成真实公告分析、引文校验导入及结果展示；技能包装脚本与独立 Node 入口返回相同结果。

P4 入口实现与上述验证完成；**新会话自动发现/自动选择技能未实测**。本轮遵循用户推进 P4 的授权，保留 P1 未完整采集、P2 真实认证未验证、P3 公司资料及人工标注集缺失等前置缺口，不将封装成功视为整体业务验收通过。没有重新采集政府网站、注册 WorkBuddy 专家或启用通知发送。

## 2. 文件与安装位置

| 位置 | 职责 |
|---|---|
| `skills/tender-assistant/SKILL.md` | 触发范围、意图到动作、证据边界及交付要求 |
| `skills/tender-assistant/agents/openai.yaml` | 技能显示名称、简介、默认示例；保留默认的自然语言匹配能力 |
| `skills/tender-assistant/scripts/tender.ps1` | 读取项目绑定，检查依赖、编译、逐项传递参数与退出码 |
| `skills/tender-assistant/references/workflow.md` | 采集、选附件、人工接管、模型输出和恢复步骤 |
| `integrations/codex/install-skill.ps1`、`README.md` | 安装、更新、文件所有权检查与卸载说明 |
| `src/assistant/cli.ts`、`catalog.ts`、`views.ts`、`README.md` | 统一路由、快照选择、只读清单与证据分页 |
| `test/unit/assistant.test.ts`、`assistant-cli.test.ts`、`skill-install.test.ts` | 8 项新增行为测试 |
| `package.json`、根 `README.md`、总体执行方案 | 新增 `assistant` 命令及阶段状态、使用说明 |
| 本文件、`docs/P4-verification.json` | 输出样例、实测、证据路径与内容哈希 |

实际宿主安装：`C:\Users\14629\.codex\skills\tender-assistant`。安装包共 5 个受管理文件：4 个源码技能文件和生成的 `project.json`；额外 `.install-manifest.json` 记录所有权与哈希。项目绑定为 `D:\creator\coding_project\tender-assistant`。不修改宿主安装缓存或 Codex 全局配置。

技能是任务说明和命令包装，AI 分析提示词仍在项目 `prompts/`，每个 P3 快照保存当时版本。技能不复制站点 DOM、分页、下载、去重和资格校验逻辑。运行数据仍在 `C:\Users\14629\AppData\Local\TenderAssistant`。

本机采用当前可用的 `.codex/skills` 技能根；不同环境可以通过安装器 `-Destination` 指定官方文档列出的 `.agents/skills/tender-assistant`，同一环境避免重复安装同名技能。安装路径依据和官方链接见 [安装说明](D:/creator/coding_project/tender-assistant/integrations/codex/README.md)。

## 3. 自然语言入口和独立复现

使用示例：

> 使用 $tender-assistant 查看最近一次正式检索结果，说明已分析数量、材料缺口和需要人工复核的项目。

> 使用 $tender-assistant 对已有正式结果中正文完整的公告继续分析一条，引用原文，说明尚未取得的材料。

> 使用 $tender-assistant 按已确认的“网站开发、广东、最近7天”重新采集，并展示本轮完成范围和清单。

第三个示例会真实访问网站。前两个使用本地快照；不用重新登录或采集。候选数不等于有效商机数；已分析和待分析分开报告。

```powershell
# 在项目根目录
pnpm run assistant doctor
pnpm run assistant results --limit 5
pnpm run assistant queue --limit 5
pnpm run assistant collect --help
pnpm run assistant archive --help
pnpm run assistant analyze --help

# 在任意目录，明确调用已安装的技能脚本
& 'C:/Users/14629/.codex/skills/tender-assistant/scripts/tender.ps1' results --limit 5

# 同一动作的独立程序入口（先在项目根 pnpm run build）
node 'D:/creator/coding_project/tender-assistant/dist/src/assistant/cli.js' results --limit 5
```

包装脚本每次编译源码；机器读取 JSON 时可直接调用编译后的 Node 入口，避开 pnpm 的命令横幅。`collect/archive/analyze` 同进程加载原 CLI，保留原阶段参数、输出、运行锁和取消处理；不会启动另一套采集器。直接阶段命令仍可用。

## 4. P4 CLI 与输出字段

| 动作 | 参数与行为 |
|---|---|
| `doctor` | 不接收额外参数。检查 Node >=24.13、项目编译入口及基线；`ready` 不代表浏览器、登录或站点验证通过 |
| `results` | 默认最新正式 P3 快照；`--run <ID>` 精确指定；`--purpose diagnostic` 才可看诊断任务 |
| `queue` | 同上；默认只取当前版本、未分析、正文完整、规则未排除的包，附件可能缺失 |
| `packet` | 必须同时指定 `--run` 和 `--packet`；返回原始证据和版本，第一页提供快照提示词 |
| `collect/archive/analyze` | 后续参数交原 CLI。真实采集、附件归档和模型导入都需对应显式动作 |

只读动作使用 `--offset N --limit N`：从 0 开始，清单/队列默认 10、最大 50；证据默认 3、最大 10 个单元，每个原有 P3 单元最多约 4,000 字符。`nextOffset=null` 为末页；偏移越界报错，不静默返回“没有数据”。较大文件需分页，不将读了第一页说成读完全部附件。

| 字段 | 含义 |
|---|---|
| `schemaVersion` | P4 输出协议版本，当前 1；原阶段保留原协议 |
| `status` | `snapshot` 或 `no-analysis-run`；后者不是站点查询零结果 |
| `purpose/runId/createdAt/sourceReport` | 正式或诊断用途、快照 ID、创建时间与 P1 来源路径 |
| `counts` | 当前观察版本的候选、已分析、待分析、相关、不相关、待复核数量；`totalVersions` 包含历史版本 |
| `items/total/offset/nextOffset` | 当前页面、该视图总数和下一页；结果先展示已分析行，其余按公告标识排序 |
| `modelStatus/coverage/queryComplete/window` | 是否模型分析、材料范围、查询完整性、当次固定时间窗 |
| `pending/ready/deferred` | 队列总待分析、当前可送分析、因正文缺失或规则排除而未选；deferred 不是已分析 |
| `inputHash/ruleVersion/promptVersion/companyVersion` | 模型输出必须保留的原版本，用于导入校验 |
| `artifacts` | 现有 Markdown/JSON/CSV 位置及是否存在；导出可能过时，可显式 `analyze --run <ID> --render` 重建 |
| `notification/p3AcceptanceComplete` | `preview-only-not-sent`、`false`；不因为查询命令成功而改变 |

`results/queue/packet` 从经过哈希和字段验证的 P3 快照、结果计算，不从可手工修改的 `report.json` 直接取统计。最新按快照 `createdAt` 选取，不按目录修改时间；不回退其他用途。目录扫描遇损坏快照会报错，应修复或显式选定另一个有效 ID，不静默跳过。查看过程不写归档或调用模型。

退出码：新入口参数/损坏/读取错误为 1；`doctor` 条件不满足为 2；成功读取包括“尚无分析”时为 0。委派动作沿用阶段码：P1 0/2/130/1、P2/P3 以对应帮助和报告为准。取消时底层执行原有清理逻辑；本轮验证了既有本地浏览器取消用例，未额外实测政府登录或手动 Ctrl+C。

## 5. 实测和输出样例

本轮完整阅读并分析一份正式快照中的真实公告：“关于【河源市东源县新港镇、骆湖镇城镇开发边界调入地块地质灾害风险性评价项目】中选结果的公告”。标题、正文共 2 个证据单元；模型判断与网站开发不相关，注明其为中选结果，并保留服务金额区间次序异常、原采购文件和公司资料缺失。

实际流程：已安装 Skill → `doctor` → `queue` → `packet` → 当前 Codex 会话生成 JSON → `analyze --import` 引文/版本校验 → `results`。模型精确标识未知，记录 `unknown-exact-model`；没有另启模型 API。

| 用途 | P3 快照 | 候选 | 已分析 | 待分析 | 相关 / 不相关 / 复核 |
|---|---|---:|---:|---:|---:|
| 正式 | `p3-e4a64e54dcd8b04f34081fcc` | 488 | 4 | 484 | 0 / 2 / 486 |
| 诊断 | `p3-e92eb39de5fbd08e9eab0317` | 40 | 3 | 37 | 0 / 0 / 40 |

正式待分析队列 ready=10、deferred=474。P1 正式查询窗口为 2026-09-17 至 2026-09-23 任务启动时，广东仍有采集不完整标识。上述“0 相关”只说明当前已分析/规则判定情况，**不证明剩余候选均不相关**。

节选真实输出（只保留部分字段）：

```json
{
  "schemaVersion": 1,
  "action": "results",
  "purpose": "formal",
  "status": "snapshot",
  "runId": "p3-e4a64e54dcd8b04f34081fcc",
  "counts": { "candidates": 488, "modelAnalyzed": 4, "pending": 484, "related": 0, "irrelevant": 2, "review": 486 },
  "notification": "preview-only-not-sent",
  "p3AcceptanceComplete": false
}
```

此次新增结果位于受控目录 `runs/p3-e4a64e54dcd8b04f34081fcc/session-output/p4-geology-review.json` 及校验后的 `results/`；没有把原文或模型材料加入 Git。P3 历史记录仍保留“首轮 6 份”，当前累计 7 份由本记录说明。

验证证据及 SHA-256 见 [P4-verification.json](D:/creator/coding_project/tender-assistant/docs/P4-verification.json)。完整命令输出在 `output/playwright/p4-entry/`，不提交 Git。机器统计和文档仅记录当前时点，不保证此后业务数据不变。

## 6. 验证结果和限制

- `pnpm run check`、`pnpm run build` 通过；`pnpm test` **46/46 通过**，其中新增 8 项 P4 测试。包括用途隔离、最新/损坏快照、当前版本、正文缺失、证据分页完整性、命令转交、错误退出、带空格安装路径、更新/卸载保护。
- `skill-creator/scripts/quick_validate.py` 对源包通过；安装副本、UI YAML 和源/安装一致性另外检查。校验器所需 PyYAML 6.0.3 仅装在已忽略的 `output/playwright/p4-validator-deps/`，未添加产品依赖。
- 本机 PowerShell 5.1 实际运行安装、重复安装、包装调用及受控卸载通过。首次测试发现独立 PowerShell 中 `Get-FileHash` 不可用、PATH 存在多个 Node 返回值；改用 .NET 哈希和显式首个 Node 后通过。
- 安装副本与独立 Node 对同一正式任务 `results --limit 4` 的 JSON 完全相同；真实新增模型结果导入成功。`archive --verify` 为 5 个对象、3 份公告、0 错误。
- 没有新增政府站点请求；技能自动选择、新会话发现、真实账号接管和跨日复用未验证，WorkBuddy 未注册。现有 P1/P3 业务验收缺口、公司资质与人工标注集仍待补齐。

## 7. 更新、回滚和后续

在项目根执行 `& ./integrations/codex/install-skill.ps1` 更新。安装器仅覆盖自己管理且未被改动的文件；本地手工修改会报错，先保留并核查差异。卸载：`& ./integrations/codex/install-skill.ps1 -Uninstall`，不会删除项目和业务数据。源码和安装副本分开维护，安装细节与中断恢复见安装 README。

行为变化：新增统一命令和个人技能；本轮正式结果增加 1 份模型分析并重新导出报告。原阶段参数、正式搜索范围、采集频率与通知策略保持原配置。回滚入口可卸载技能并撤销本轮源码文件；运行材料保留供追溯，不随代码回滚自动删除。

后续按用户指令推进 P5 通知预览/调度相关实现和 P6 试运行；当前没有创建任何周期任务或外部通知。真实公司匹配与上述验收缺口需按各阶段补齐。建议提交：`feat: 封装招投标助手 Codex 技能与统一入口`（本次仅建议，未自动提交）。
