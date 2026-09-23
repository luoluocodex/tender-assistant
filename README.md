# 招投标信息助手

项目目录：`D:\creator\coding_project\tender-assistant`。

首轮目标是在广东省公共资源交易平台、中国政府采购网上，检索广东地区最近 7 天的“网站开发”相关公告。使用 Codex 作为主要入口，手动触发，只生成通知预览。

当前已实现 P1 两站公开采集原型，并完成首轮真实网站验证，**尚未全部通过 P1 验收**。正式查询在全国站返回零结果；广东站读取 49 页、去重后 488 条候选，第 50 页遇到 HTTP 429，20 份详情中 14 份正文完整。P1 的诊断验证、证据和剩余缺口见执行记录；程序退出成功与 P1 全部验收通过是两个独立结论。

按用户后续指令继续实现了 **P2 登录会话、附件解析和本地归档**。5 份真实公开附件已下载解析并归档，重跑复用与备份恢复已验证。真实账号登录、跨日复用、CA/证书仍未验证；本轮样本无需登录，不把受控会话测试当作真实认证成功。

**P3 核心分析流程与首轮验证已实现，完整验收未通过。** 现有 488 份正式候选和 40 份诊断候选已生成清单；当前 Codex 会话对其中 6 份公告完成初步分析并校验导入，5 份 P2 附件进入证据包。剩余候选明确标待分析，真实公司资料与人工标注集尚缺，不宣称全量 AI 分析或业务准确率达标。

## 文档与配置

- [P0 执行记录](D:/creator/coding_project/tender-assistant/docs/P0-范围与环境确认.md)：已确认事项、环境结果、站点能力和 P1 准入条件。
- [P1 执行记录](D:/creator/coding_project/tender-assistant/docs/P1-两站公开采集验证.md)：查询结果、关键发现、验证证据与未覆盖项。
- [P2 执行记录](D:/creator/coding_project/tender-assistant/docs/P2-登录附件与归档.md)：真实附件、会话边界、归档结构、恢复操作与验收记录。
- [P3 执行记录](D:/creator/coding_project/tender-assistant/docs/P3-过滤去重与AI分析.md)：规则、公告版本、提示词、摘要、资格检查、实际成绩与待验收项。
- [执行方案](D:/creator/coding_project/tender-assistant/docs/招投标信息助手执行方案.md)：P0—P6 的总体实施计划。
- [首轮配置基线](D:/creator/coding_project/tender-assistant/config/p0-baseline.json)：网站开发、广东、最近 7 天、手动、通知预览。
- [站点能力登记](D:/creator/coding_project/tender-assistant/config/sites.json)：区分前期浏览观察、P1 独立脚本实测和仍未验证的能力。
- [P1 运行配置](D:/creator/coding_project/tender-assistant/config/p1.json)：访问间隔、页数上限、详情抽样数量与证据位置。
- [P2 运行配置](D:/creator/coding_project/tender-assistant/config/p2.json)：已确认数据目录、附件来源、体积/解析限制和保存策略。

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

P1 浏览器验证材料仍位于已忽略的 `output/playwright/`。真实材料可能包含公开联系方式及带访问参数的附件链接，不作为测试 fixture 提交 Git。普通日志去掉 URL 查询参数，完整来源只保存在受限归档中。

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

P1 的限流与模板缺口仍需补齐。P3 已有确定性规则和会话分析闭环，但真实公司匹配、人工标注验收、批量 AI 分析和独立的项目更新采集尚未完成。外部通知与 P4 宿主 Skill 封装未实施。附件能解析不等于内容完整、业务相关或满足投标资格。

## P3 使用入口

```powershell
pnpm run analyze:p3 --help
pnpm run analyze:p3 --prepare --report output/playwright/2026-09-23T11-05-57-738Z-formal/report.json
pnpm run analyze:p3 --run p3-e4a64e54dcd8b04f34081fcc --render
```

`--prepare` 生成证据包及 JSON/CSV/Markdown 清单；由当前 Codex 会话按 `prompts/` 进行分析后，以 `--import` 校验导入。程序不会自动调用模型。输出保留相关性、公告阶段、材料完整性、待分析状态和公司资料缺口。`--previous` 与 `--track`、合成公司资料及人工标签评估的完整说明见 P3 执行记录。

退出码 `0` 仅表示当前步骤成功，配置/输入/校验失败为 `1`，不表示 P3 验收通过。业务状态应读取报告中的 `modelStatus`、`coverage`、`eligibility` 和 `p3AcceptanceComplete`。
