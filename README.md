# 招投标信息助手

项目目录：`D:\creator\coding_project\tender-assistant`。

首轮目标是在广东省公共资源交易平台、中国政府采购网上，检索广东地区最近 7 天的“网站开发”相关公告。使用 Codex 作为主要入口，手动触发，只生成通知预览。

**P6 技术交接材料与本地复核已完成，用户已于 2026-09-24 确认接收有限范围的阶段性交付；完整业务验收仍未通过。** 已接收范围为本地手动、人工复核、通知预览的原型，现有待完成项保留。优先阅读[最终技术方案](D:/creator/coding_project/tender-assistant/docs/招投标助手最终技术方案.md)、[操作与维护手册](D:/creator/coding_project/tender-assistant/docs/操作与维护手册.md)及[P6 验收记录](D:/creator/coding_project/tender-assistant/docs/P6-验收与交接.md)。下列阶段记录保留其采样日期，不能因进入下一阶段而视为历史缺口已关闭。

当前已实现 P1 两站公开采集原型，并完成首轮真实网站验证，**尚未全部通过 P1 验收**。正式查询在全国站返回零结果；广东站读取 49 页、去重后 488 条候选，第 50 页遇到 HTTP 429，20 份详情中 14 份正文完整。P1 的诊断验证、证据和剩余缺口见执行记录；程序退出成功与 P1 全部验收通过是两个独立结论。

按用户后续指令继续实现了 **P2 登录会话、附件解析和本地归档**。5 份真实公开附件已下载解析并归档，重跑复用与备份恢复已验证。真实账号登录、跨日复用、CA/证书仍未验证；本轮样本无需登录，不把受控会话测试当作真实认证成功。

**P3 核心分析流程与首轮验证已实现，完整验收未通过。** 现有 488 份正式候选和 40 份诊断候选已生成清单；P3 首轮对其中 6 份公告完成初步分析并校验导入，5 份 P2 附件进入证据包。剩余候选明确标待分析，真实公司资料与人工标注集尚缺，不宣称全量 AI 分析或业务准确率达标。

**P4 Codex 技能与统一命令已实现并安装。** 已通过当前会话显式读取技能、调用脚本、分析真实公告并导入结果的闭环；独立命令与技能输出一致。P4 新增 1 份正式公告初步分析，累计正式 4 份、诊断 3 份；后续 P5/P6 已确认技能在可用列表中，自动意图选择仍未独立验证。P1/P3 验收缺口仍保留。

**P5 本地通知预览、去重、恢复与备份验证已实现，完整 P5 验收仍待进行。** 2026-09-24 使用已有真实快照生成正式提示 2 条，重跑新增 0 条；诊断提示 3 条单独标识。通知回执、归档备份与新目录恢复通过，56 项测试通过。实际发送和周期任务继续关闭；未开展连续 3 个实际运行日的试运行。本轮还确认已安装技能出现在可用技能列表中，自动意图选择仍未独立验证。

## 文档与配置

- [2026-09-24 审查缺陷修复](D:/creator/coding_project/tender-assistant/docs/2026-09-24-审查缺陷修复.md)：6 项修复、合成回归、数据库与通知账本升级，以及旧材料处理边界。
- [最终技术方案](D:/creator/coding_project/tender-assistant/docs/招投标助手最终技术方案.md)：当前实际架构、目录、提示词与脚本组织、覆盖边界。
- [操作与维护手册](D:/creator/coding_project/tender-assistant/docs/操作与维护手册.md)：日常操作、人工接管、恢复、备份、更新与卸载。
- [P6 验收与交接](D:/creator/coding_project/tender-assistant/docs/P6-验收与交接.md)、[机器复核记录](D:/creator/coding_project/tender-assistant/docs/P6-verification.json)：本轮检查、未完成项与用户签收状态。
- [P0 执行记录](D:/creator/coding_project/tender-assistant/docs/P0-范围与环境确认.md)：已确认事项、环境结果、站点能力和 P1 准入条件。
- [P1 执行记录](D:/creator/coding_project/tender-assistant/docs/P1-两站公开采集验证.md)：查询结果、关键发现、验证证据与未覆盖项。
- [P2 执行记录](D:/creator/coding_project/tender-assistant/docs/P2-登录附件与归档.md)：真实附件、会话边界、归档结构、恢复操作与验收记录。
- [P3 执行记录](D:/creator/coding_project/tender-assistant/docs/P3-过滤去重与AI分析.md)：规则、公告版本、提示词、摘要、资格检查、实际成绩与待验收项。
- [P4 执行记录](D:/creator/coding_project/tender-assistant/docs/P4-Codex技能与统一入口.md)：技能位置、自然语言用法、命令协议、输出样例、安装更新和卸载。
- [P5 执行记录](D:/creator/coding_project/tender-assistant/docs/P5-通知预览与手动试运行.md)：事件规则、状态与回执、恢复、备份、真实预览样本及待验收项。
- [执行方案](D:/creator/coding_project/tender-assistant/docs/招投标信息助手执行方案.md)：P0—P6 的总体实施计划。
- [首轮配置基线](D:/creator/coding_project/tender-assistant/config/p0-baseline.json)：网站开发、广东、最近 7 天、手动、通知预览。
- [站点能力登记](D:/creator/coding_project/tender-assistant/config/sites.json)：区分前期浏览观察、P1 独立脚本实测和仍未验证的能力。
- [P1 运行配置](D:/creator/coding_project/tender-assistant/config/p1.json)：访问间隔、页数上限、详情抽样数量与证据位置。
- [P2 运行配置](D:/creator/coding_project/tender-assistant/config/p2.json)：已确认数据目录、附件来源、体积/解析限制和保存策略。
- [P5 运行配置](D:/creator/coding_project/tender-assistant/config/p5.json)：本地预览对象、72/24 小时临期窗口、重试上限；不启用外发或调度。

`p0-baseline.json` 保留 P0 的历史标识，P1 读取其中已确认的关键词、地区和运行边界。后续阶段未启用的字段不代表已经实现。`sites.json` 是站点能力记录，P1 适配器只支持已实现的两个来源。

## 环境准备

本机基线为 Node.js 24.13.0、pnpm 10.28.1。Playwright 固定为 1.63.0；依赖由 `pnpm-lock.yaml` 锁定。

P2 使用 Node 内置 SQLite，运行要求提高为 **Node.js >=24.13.0**。本机该模块仍会显示 ExperimentalWarning，已通过实际归档、备份恢复和测试验证；未更换系统 Node。解析依赖为 PDF.js、yauzl、fast-xml-parser、word-extractor，均固定版本，不调用 Office 或执行宏。

重建项目依赖：

```powershell
Set-Location -LiteralPath 'D:\creator\coding_project\tender-assistant'
pnpm install --frozen-lockfile --ignore-scripts
```

本命令只安装依赖。已在本机验证随 Playwright 对应的 Chromium 153.0.8010.12 有头启动；缺少浏览器的其他机器需执行 `pnpm exec playwright install chromium`。TypeScript 和 Node 类型定义仅用于开发和编译，版本随锁文件固定。

## 运行与验证

在项目目录执行：

```powershell
pnpm run check
pnpm test
pnpm run collect:p1
```

`collect:p1` 自动构建并打开专用的有头 Chromium。手动运行，每次创建独立证据目录；查询截止时刻固定为该次任务开始，随后翻页不延后边界。结束或取消时关闭本次创建的浏览器。测试包含三个仅使用本地合成页面的有头浏览器用例，不请求政府网站。

当前请求操作间隔至少 6 秒，每次最多运行 20 分钟。遇到 HTTP 403、429 或人工验证页面，停止该站后续查询与详情，不自动重试；保留进度和原因，其他站点可以继续。此前广东站限流发生在较短间隔下，提高间隔后的广东稳定性尚未复测，不能承诺避免限流。

从 P5 起，P1 独立 CLI 也与归档、分析、通知及备份共用运行数据目录的锁。2026-09-24 修复后，由常驻 `archive.lock.sqlite` 文件的 SQLite 排他锁保证互斥，`archive.lock` 保存 PID 标记。其他步骤运行时拒绝启动新采集；正常结束、取消或进程退出释放互斥，旧 PID 标记在互斥内回收。不要删除互斥数据库或混跑新旧程序。

| 参数 | 含义 |
|---|---|
| `--site both` / `ccgp` / `guangdong` | 默认两站；单站运行只代表对应来源验证 |
| `--max-pages N` | 降低本轮每个查询的页数上限，默认配置为 120 页；上限触发时标部分完成 |
| `--max-details N` | 降低每站详情样本数，默认 20；按公告类型抽样，不等于读取每份候选详情 |
| `--diagnostic --keyword 软件` | 明确标记为诊断查询；不更改正式关键词，不计入业务成果 |
| `--help` | 查看命令说明 |

例如，验证分页和详情而不扩大正式业务条件：

```powershell
pnpm run collect:p1 --diagnostic --keyword 软件 --site ccgp --max-pages 2 --max-details 3
```

退出码：`0` 表示所选查询及已抽样详情成功；`2` 表示部分完成、失败或需要人工；`130` 表示取消或到达运行时限；配置/启动入口错误为 `1`。通过 pnpm 调用时也应读取末行 JSON 与 `report.json`，pnpm 可能将脚本非零退出包装为自身错误。

输出位于 `output/playwright/<运行编号>/`，不提交 Git：

- `report.json`：固定窗口、目的、查询、详情、完整性、错误及 `p1AcceptanceComplete`。
- 各查询 JSON 和 `progress.json`：已检查页、候选、排除与待复核记录。P1 暂不提供断点续跑命令。
- 公开页面 TXT、HTML、PNG 和广东站原始响应：保留来源证据。封闭正文单独保存为 `gd-shadow-*.json`，普通页面 HTML 无法包含该正文。
- `detail-*.json`：正文、哈希、字段原文与来源文件；金额和日期保持原文，不自动做币种、单位或项目资格推断。
- `notification-preview.md`：本地预览，程序不发送通知。

中国政府采购网需要分别查询“广东（不含深圳）”和“深圳”，并分别验证标题/全文检索。广东平台采用站点分词查询，候选可能只匹配“开发”，不能视为有效商机；清单中的短语出现标识也不是语义相关性分析。

## 数据位置

源码、分析提示词和配置保存在项目目录。P2 已在 `C:\Users\14629\AppData\Local\TenderAssistant` 创建数据库、原始公告、附件、解析结果与任务记录，P3 产物保存在其中 `runs/p3-*/`。权限限制为当前 Windows 用户和 SYSTEM。会话位于 `private/sessions/`，不进入备份。所有材料保留到人工验收，不自动删除；备份为本地同盘副本，不代表异地备份。

P1 浏览器验证材料仍位于已忽略的 `output/playwright/`，不在现有归档备份内；迁移时必须另行保留关联的完整 P1 运行目录。P3/P5 仍引用原 P1 报告路径，异机恢复尚未验证。真实材料可能包含公开联系方式及带访问参数的附件链接，不作为测试 fixture 提交 Git；P1 证据目录不自动继承运行数据根的受限权限，分享前需检查。普通日志去掉 URL 查询参数，完整来源只保存在相应证据与归档文件中。

实际账号、Cookie、令牌、公司资料及通知凭据不得放入仓库。首轮不接入公司资质资料，不选择付费模型 API，不创建定时任务，不实际发送通知。

## P2 使用入口

从 P1 报告中显式选择附件，序号从 0 开始；不会自动下载全部候选。以下是本次已验证的诊断任务，重跑默认先校验并复用已有内容：

```powershell
pnpm run archive:p2 --resume p2-73e744bf-0d47-4b5b-9336-e1644a201643
pnpm run archive:p2 --verify
pnpm run archive:p2 --backup
pnpm run archive:p2 --help
```

首次运行、`--refresh`、来源登记、人工登录/导入以及恢复到新目录的命令见 P2 执行记录。关闭重开或取消后使用同一任务 ID 继续；完成文件通过哈希验证后复用。重新下载以检查原链接内容变化时显式使用 `--refresh`，保留旧版本。不会自动刷新过期签名链接。

## 限制与下一阶段

P1 命令仍只采集公开列表和正文；P2 命令负责附件与归档，两者分开运行。未知详情模板、正文缺失、查询不完整均保留明确状态。P2 尚未验证真实认证、跨日会话、CA/UKey 和无头模式；扫描件、加密、RAR/其他不支持格式返回明确状态，不自动 OCR 或破解密码。

P1 的限流与模板缺口仍需补齐。P3 已有确定性规则和会话分析闭环，但真实公司匹配、人工标注验收、批量 AI 分析和独立的项目更新采集尚未完成。P4 已封装 Codex 入口；WorkBuddy 入口、外部通知及周期调度未实施。附件能解析不等于内容完整、业务相关或满足投标资格。

## P3 使用入口

```powershell
pnpm run analyze:p3 --help
pnpm run analyze:p3 --prepare --report output/playwright/2026-09-23T11-05-57-738Z-formal/report.json
pnpm run analyze:p3 --run p3-e4a64e54dcd8b04f34081fcc --render
```

`--prepare` 生成证据包及 JSON/CSV/Markdown 清单；由当前 Codex 会话按 `prompts/` 进行分析后，以 `--import` 校验导入。程序不会自动调用模型。输出保留相关性、公告阶段、材料完整性、待分析状态和公司资料缺口。`--previous` 与 `--track`、合成公司资料及人工标签评估的完整说明见 P3 执行记录。

退出码 `0` 仅表示当前步骤成功，配置/输入/校验失败为 `1`，不表示 P3 验收通过。业务状态应读取报告中的 `modelStatus`、`coverage`、`eligibility` 和 `p3AcceptanceComplete`。

## P4 使用入口

已安装本机技能：`C:\Users\14629\.codex\skills\tender-assistant`，源文件位于 `skills/tender-assistant/`。可在 Codex 输入：

> 使用 $tender-assistant 查看最近一次正式检索结果，说明已分析数量和材料缺口。

当前技能已在宿主可用列表中，显式调用闭环已验证；若其他会话未列出技能，可先使用下面的确定性入口。不要因技能未被自动发现而重复采集。

```powershell
# 在项目根目录执行；原有 P1/P2/P3 命令继续可用
pnpm run assistant doctor
pnpm run assistant results --limit 5
pnpm run assistant queue --limit 5
pnpm run assistant results --purpose diagnostic --limit 3

# 从任意工作目录执行已安装技能
& 'C:/Users/14629/.codex/skills/tender-assistant/scripts/tender.ps1' results --limit 5

# 更新技能（拒绝覆盖手工修改），卸载时添加 -Uninstall
& ./integrations/codex/install-skill.ps1
```

`results/queue/packet` 读取已有分析，默认正式用途，不联网或调用模型；技能包装脚本先编译源码。`collect/archive/analyze` 原样转交对应阶段。新采集仍需显式 `collect`，模型分析仍由当前会话读取证据完成；不保证一次指令自动分析全部候选。

## P5 使用入口

可在 Codex 输入：“使用 $tender-assistant 为已有正式结果生成通知预览，说明采集故障和资料缺口。”

```powershell
pnpm run assistant notify --preview
pnpm run assistant notify --status
pnpm run assistant notify --verify
pnpm run assistant notify --backup
pnpm run assistant notify --help
```

`notify --preview --run <P3-ID>` 可固定输入；诊断加 `--purpose diagnostic`。成功生成会返回 P5 运行 ID 和 Markdown 路径；`previewed` 表示本地文件已生成，外部发送始终为 0。重复事件复用预览；已知失败使用 `notify --resume <P5-ID>` 显式恢复，未知结果先 `notify --reconcile <通知ID>`。账本和转换历史保存在 `runs/p5-notifications/`，各次记录在 `runs/p5-*/`，均进入现有备份。

临期仅识别明确到分钟、无冲突/条件延期的响应截止时间。待分析、来源失败和资料不足分别保留，不把 488 条候选说成有效商机。通知对象 `local-user` 只是本地去重标识，不是邮箱或 IM 账号。外部渠道、运行时间及连续试运行需按后续明确范围接入；当前不能仅修改开关就启用。

## P6 交接状态

2026-09-24 重新运行 56 项测试和类型检查通过；当前 5 个归档对象、3 个公告版本、7 份已导入分析及 5 条通知预览校验通过。P5 原备份 3,299 个文件指纹全部一致，原恢复演练目录再次通过对象和回执检查。本轮未重新采集政府网站、新增 AI 分析、登录、外发或创建自动任务。

正式 484 份、诊断 37 份仍待分析；广东采集完整性、真实认证、公司匹配、人工质量评估、实际通知及多日运行尚未验收。完整矩阵与有限范围交接确认栏见 P6 记录；当前 `businessAcceptancePassed=false`、`userAcceptance=accepted-limited-scope`。
