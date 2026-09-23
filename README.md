# 招投标信息助手

项目目录：`D:\creator\coding_project\tender-assistant`。

首轮目标是在广东省公共资源交易平台、中国政府采购网上，检索广东地区最近 7 天的“网站开发”相关公告。使用 Codex 作为主要入口，手动触发，只生成通知预览。

当前已实现 P1 两站公开采集原型，并完成首轮真实网站验证，**尚未全部通过 P1 验收**。正式查询在全国站返回零结果；广东站读取 49 页、去重后 488 条候选，第 50 页遇到 HTTP 429，20 份详情中 14 份正文完整。P1 的诊断验证、证据和剩余缺口见执行记录；程序退出成功与 P1 全部验收通过是两个独立结论。

## 文档与配置

- [P0 执行记录](D:/creator/coding_project/tender-assistant/docs/P0-范围与环境确认.md)：已确认事项、环境结果、站点能力和 P1 准入条件。
- [P1 执行记录](D:/creator/coding_project/tender-assistant/docs/P1-两站公开采集验证.md)：查询结果、关键发现、验证证据与未覆盖项。
- [执行方案](D:/creator/coding_project/tender-assistant/docs/招投标信息助手执行方案.md)：P0—P6 的总体实施计划。
- [首轮配置基线](D:/creator/coding_project/tender-assistant/config/p0-baseline.json)：网站开发、广东、最近 7 天、手动、通知预览。
- [站点能力登记](D:/creator/coding_project/tender-assistant/config/sites.json)：区分前期浏览观察、P1 独立脚本实测和仍未验证的能力。
- [P1 运行配置](D:/creator/coding_project/tender-assistant/config/p1.json)：访问间隔、页数上限、详情抽样数量与证据位置。

`p0-baseline.json` 保留 P0 的历史标识，P1 读取其中已确认的关键词、地区和运行边界。后续阶段未启用的字段不代表已经实现。`sites.json` 是站点能力记录，P1 适配器只支持已实现的两个来源。

## 环境准备

本机基线为 Node.js 24.13.0、pnpm 10.28.1。Playwright 固定为 1.63.0；依赖由 `pnpm-lock.yaml` 锁定。

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

源码、未来分析提示词和配置保存在项目目录；正式运行数据默认使用 `C:\Users\14629\AppData\Local\TenderAssistant`，P1 尚未建立该归档。当前公开页面验证材料保存在已忽略的 `output/playwright/`，保留到人工验收，不自动删除。它们可能包含公告公开的联系方式及文件链接，不作为测试 fixture 提交 Git。

实际账号、Cookie、令牌、公司资料及通知凭据不得放入仓库。首轮不接入公司资质资料，不选择付费模型 API，不创建定时任务，不实际发送通知。

## 限制与下一阶段

P1 不执行登录、附件下载、SQLite 归档、业务相关性过滤、AI 摘要、公司资质匹配或外部通知。未知详情模板、正文缺失、查询不完整均保留明确状态；有头运行通过不代表无头已验证。

后续先处理 [P1 执行记录](D:/creator/coding_project/tender-assistant/docs/P1-两站公开采集验证.md) 的验收缺口，再按授权进入 P2。重新执行当前命令会新建运行记录，不覆盖已有结果。
