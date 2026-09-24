# 操作、恢复与分析规范

下列命令都通过本技能 `scripts/tender.ps1`，或在项目根执行 `pnpm run assistant`。读取文件先用 `doctor` 获取项目和数据根目录。结果是已有快照；`createdAt`、公告日期和查询窗口都必须保留。

## 采集和归档

1. `collect` 默认执行正式基线。退出码 2 表示部分完成，仍可用返回的 P1 `report.json` 路径准备分析，但报告必须显示不完整原因；取消、网站登录页、403/429 不可静默重试。恢复前读报告而非重复整批操作。
2. `archive --report <绝对路径> --pick <公告ID:零起始附件序号>` 可重复 `--pick`；公告 ID 和序号从 P1 详情读取，不能从标题猜测。归档成功后保留 P2 任务 ID。
3. `analyze --prepare --report <绝对路径> [--archive-job <P2任务ID>]`，按 stdout 中 `id` 使用对应 P3 快照。如果已有跟踪快照，可显式加 `--previous <P3任务ID>`；正式和诊断不能混合。
4. `results --run <P3任务ID>` 查看规则清单，尚未导入模型结果的行仍是 pending。

P1 不支持任意查询条件：更改正式关键词/地域/日期需先按用户的新要求调整配置和验证，不能用诊断关键词冒充正式搜索。有限诊断：`collect --diagnostic --keyword 软件 --site ccgp --max-pages 1 --max-details 1`，执行前确保这是用户授权的诊断。

## 人工接管

先读 `archive --help` 与项目 `docs/P2-登录附件与归档.md`，确认受支持的来源 ID；不得猜测账号密码。

- `archive --auth <source> --account <别名>` 在带 TTY 的终端运行并保持会话。程序打开专用浏览器，提示用户完成登录后，终端输入程序要求的 `done` 或 `cancel`。账号内容不进入提示词；不可代用户声明已登录。
- `archive --resume <P2任务> --session <source> --account <别名>` 使用对应会话恢复选定任务。会话保存成功不等于下载权限验证成功。
- 遇人工下载可用 `archive --resume <任务> --item <条目标识> --session <source> --manual-download`，或用户实际下载后 `--import-file <本地文件>`；参数组合以 `--help` 为准。
- 验证码、CA、手机确认由用户处理。仅中断本次命令，等待阶段清理浏览器；不要结束用户其他浏览器。P4 不新增无人值守认证。

## 当前会话进行 AI 分析

1. `queue --run <ID> --limit 5`。默认仅正文完整、未分析、未被规则排除的当前版本；deferred 不是已排除商机，可能缺正文。诊断任务每次都加 `--purpose diagnostic`。
2. 对明确的 `packetId` 执行 `packet --run <ID> --packet <ID> --offset 0 --limit 3`。读取第一页的版本、`prompts`、`resultSchema`，然后按 `nextOffset` 读取所有要分析的证据单元。大附件按需限定范围，并在 missing/limitations 写明未阅读部分，不能推断整份文件缺项。
3. 按快照中的提示词分析；从项目 `schemas/analysis-result.schema.json` 获取完整字段规范。以证据支撑事实，推断单独列出；保留 title/body/attachment/company 的证据类型，不把采购条款当公司证明。每个 citation 必须是对应 evidence.text 的逐字非空子串。
4. 结果 JSON 对象或数组写入 `runtimeRoot/runs/<P3-ID>/session-output/`，先检查目录；不要存到 Git。复制 `packetId/inputHash/ruleVersion/promptVersion/companyVersion`；按实际分析宿主填写 `provider`：Codex 用 `codex-session`，WorkBuddy 用 `workbuddy-session`，模型标识未知时 `model="unknown-exact-model"`，不编造版本。旧快照提示词中的固定 `codex-session` 仅代表历史宿主，按当前 schema 和实际宿主填写 provider；其余输入及版本字段原样保留，不修改旧快照。缺少公司材料保持 `companyCitations=[]`，资格为“资料不足”。不能填写不存在的 `humanApproved` 等字段。
5. `analyze --run <ID> --import <结果绝对路径>`；成功后 `results --run <ID>`。导入校验失败时阅读固定错误码并修正引用/字段；禁止跳过校验或直接改 latest 指针。重复相同结果导入幂等；一批中已成功导入的项目可保留，失败项单独修复。

程序不会启动第二个模型，也不调用模型 API；AI 由当前 Codex 或 WorkBuddy 会话实际阅读并判断，宿主自身的额度和数据处理规则适用。真实公司资料入口未实现，不能将真实材料改名 synthetic 绕过边界。自然语言调用与直接脚本调用应产生同一个 P3 任务和同一份校验后清单。

## P5 通知预览、核对与恢复

- `notify --preview [--run <P3-ID>]`：默认正式用途，从现有分析生成本地通知并写 P5 运行记录。诊断仍需 `--purpose diagnostic`。返回的是 P5 ID，保留给恢复使用；不会重新采集或调用模型。
- `notify --status`：最近 10 次运行及通知状态；`notify --verify`：核对两种用途的账本与成功回执。`related-notice` 是 AI 初判，不等于可以投标；`project-update` 只作用于对应公告/标包。临期默认 72/24 小时的预览窗口，不把未知日期或条件延期视为确定截止。
- `notify --resume <P5-ID>`：只处理 pending/failed，单项最多尝试配置的次数（默认 3）。重复准备不会自动重试失败项，也不无限重试限流或登录。
- `notify --reconcile <通知ID>`：对 writing/unknown 核对本地文件；内容匹配可标 previewed，文件缺失标 failed 后方可显式 resume；内容冲突继续 unknown，保留文件供人工核对，不能强制覆盖。
- `notify --backup`：先验证通知回执，再复用归档一致备份。`archive --restore-check <备份路径>` 只恢复到新目录演练，不切换当前数据库。新目录中 P5 内容另用 P5 校验函数验证；原报告路径缺失时，新一轮准备会明确失败，不能把历史预览当新检索。

通知账本、各次运行、回执及状态转换历史位于 `runtimeRoot/runs/`，不修改采集检查点。外发和周期调度在当前版本明确关闭；用户后续提出实际启用时需要具体渠道、对象和时间，按当时已授权范围实施，不因 P5 代码存在而启用。
