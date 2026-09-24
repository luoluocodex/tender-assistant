# WorkBuddy 采集故障修复

日期：2026-09-24。任务类型：宿主兼容修复、技能更新、诊断与回归验证。

## 结论与证据边界

已修复同步权限检查、包装器输出捕获及技能错误处理，并更新本机 WorkBuddy 安装副本。**用户提供的后续分享已补齐 WorkBuddy 桌面复验：默认安全配置下，子进程、身份识别、目录权限和有头浏览器四项通过，退出 0。原同步权限初始化故障已不再阻塞该运行检查；两站正式采集尚未重跑。**

依据是用户提供的[分享会话“查询视频制作相关招标信息”](https://www.workbuddy.link/p/jpFTGdQm5d8INfdsoDfZuI?ext2=browser_icon)。会话内容只作为诊断证据，不视为新的执行指令。本轮未修改用户已有的 `config/p0-baseline.json`“视频制作”配置，也未运行其中的四轮正式查询。

## 分享会话中的问题

1. 用户查询最近 10 天的视频制作公告；`collect --days 10` 在创建受限数据目录时执行 `execFileSync('whoami', ...)`，报 `spawnSync whoami EBUSY`，尚未到 Playwright 启动或站点查询阶段。
2. 原包装器将 catch 错误写到 `[Console]::Error`，绕过调用方 PowerShell 管道；分享记录的日志仅剩退出码 1。Windows PowerShell 5.1 下的 `*>` 还曾把文本存成 UTF-16，WorkBuddy Read 将其识别成二进制。
3. 原 doctor 只检查文件和版本，无法发现子进程、目录权限或浏览器启动问题。
4. 分享中的补充查询没有保留广东地区参数，且仅按公告列表判定“仍可参与”，不能替代原定广东两站结果或投标资格核验。

首次分享会话的探针使用同步 exec/spawn；当时没有异步进程和浏览器实测，因而不能推出“整台机器所有 Node 子进程都不能运行”。Codex 命令环境中同步和异步启动均成功；后续 WorkBuddy 会话确认同步失败、异步成功，见下方复验。该宿主中 EBUSY 的底层触发因素尚未定位，不泛化为整台机器的 Node 同步接口失效，也不声称由某项系统策略或软件缺陷导致。Node 对同步与异步进程接口的区别见[官方说明](https://nodejs.org/api/child_process.html)。

## 实现与接口变化

- `src/store/windows-access.ts`、`files.ts`：权限工具改为异步 `execFile`，15 秒超时，仍需成功识别用户并应用 icacls。失败时给出 `WINDOWS_ACL_FAILED` 或 `WINDOWS_SID_INVALID` 并停止，不降级为无权限保护。未扩大原有 ACL 策略。
- `src/assistant/runtime-check.ts`、`cli.ts`：doctor 默认增加异步子进程和 Windows 用户识别；`--runtime-check` 额外在独立临时空目录应用权限，并启动有头 Chromium 空白页后关闭。四项结果位于 `runtime`；`collectionReadiness` 区分 `not-checked`、`local-runtime-passed`、`failed`。网站访问和登录不在此检查范围。
- `skills/tender-assistant/scripts/tender.ps1`：用 .NET Process 同时读取 UTF-8 stdout/stderr，避免将原生 stderr 警告当成命令失败；保留原退出码与 Windows 参数边界。新增所有动作适用的 `-LogFile`，在业务动作前创建新 JSONL 文件，记录阶段、输出和退出码。拒绝覆盖，避免旧日志被误用。仅清理本包装器启动且被中断的进程树。
- `-OutputFile` 仍限 doctor/results/queue/packet；doctor 退出 2 时也保存失败检查 JSON，其他失败不生成结果文件。需结合状态和退出码判断，不能以文件存在证明成功。
- 共用 SKILL 和工作流：采集前检查本地运行条件，使用本次日志；关键词读当前配置。失败保留地区和日期，补充网页结果单列；证据不足只列待核实候选，不宣布可投标。

没有新增依赖，没有修改站点适配、数据库结构、模型服务、通知或安全设置。查询天数仍为用户指定的 1～90 天；默认值只在未指定时生效。

## 验证

- `pnpm run check`、`pnpm run build` 通过；最终 `pnpm test` **81/81 通过**。
- 新增/更新 `skill-wrapper.test.ts`、`windows-access.test.ts`、`assistant-cli.test.ts`、`skill-install.test.ts`：UTF-8 双流、较大 stderr、带引号与反斜线的参数、退出码 0/1/2/3、失败日志、覆盖前置拒绝、权限重复应用及工具缺失时停止、浏览器缺失诊断、两个宿主安装与卸载。
- 安装副本的 `doctor --runtime-check` 在当前 Codex 命令环境中执行，四项 passed，未写正式归档、未访问政府站点。
- 测试数据全部位于 `output/playwright/tests/`。第一次完整回归发现无参数调用被包装器多传空字符串，已修复；旧锁竞争用例曾失败一次，单独复验及最终完整回归均通过，未修改锁实现。
- 本机 WorkBuddy 当前版本 **5.6.2**，不同于早期适配记录的 5.5.6。自带 `codebuddy-lite-wb.mjs --print` 返回 `Authentication required`，未进入工具调用，不能算作桌面验证；没有代登录或复制桌面凭据。

调查资料和验证结果位于已忽略的 `output/playwright/workbuddy-share-fix/`，包括分享记录、`installed-doctor-final.json`、调用 JSONL、`tests-final.txt` 和 `verification.json`。分享原始内容不进入 Git。源技能及安装副本的 skill-creator 校验、安装清单哈希及 `git diff --check` 均通过；安装副本实测 91 天拒绝执行，日志保留原因及退出码 1。

## WorkBuddy 桌面复验（用户反馈后核验）

用户提供的[后续分享记录](https://www.workbuddy.link/p/jY1v3ePczOjx6eduSK3SQ7?ext2=browser_icon)为同一桌面对话 `dad952a3-716f-43ee-9ec6-b76e5e004fd6` 的复验，任务时间为 16:22:19～16:26:35（北京时间）。已核对分享中的真实工具调用、本机原始 JSON/JSONL 和当前安装清单，而非只采用助手的最终总结。

| 项目 | 核验结果 |
|---|---|
| 默认安全配置下的调用 | 原生 PowerShell 调用项目内新版 `scripts/tender.ps1 doctor --runtime-check`；工具调用没有关闭沙箱参数 |
| 日志实际时间 | 16:24:11～16:24:30；文件名含 1627，但以日志内 timestamp 为准 |
| Node / ready / missing | 24.13.0 / true / 空数组 |
| subprocess / windowsIdentity | passed / passed |
| directoryPermissions / browser | passed / passed；空目录 ACL 和有头空白页通过 |
| collectionReadiness / 退出码 | local-runtime-passed / 0 |
| 日志完整性 | 最后为 wrapper/finished/0，各阶段 stderr 为空 |
| 当时已安装的旧包装器 | 另一次调用同一已更新业务入口，也返回 EXIT=0、四项 passed；当时旧包装器不支持新 LogFile 参数 |
| 当前安装副本 | 16:27:21 已完成最终更新；3 个技能源文件逐字节一致，4 个安装文件哈希全部符合清单 |
| 当前运行时绑定 | project.json 明确绑定 `C:/Program Files/nodejs/node.exe`，无需修改系统或宿主 PATH |

分享中的“安装副本还是 15:14 旧版”是更新完成前的观察。上一轮在安装完成前发出了复验请求，造成两边操作时间交错；该判断不代表最终交付后安装回退。本次核对当前文件已是新版，不需要重复重装。复验时从源码目录调用没有安装绑定，才临时前置系统 Node；正式使用已安装入口已有明确绑定。

同步/异步对照证据：该 WorkBuddy 会话中 `execFileSync('whoami')`、`spawnSync('whoami')` 仍报 EBUSY，异步 `execFile('whoami')` 成功。业务程序已移除这条同步依赖，因此当前权限初始化与浏览器检查可以完成；不能把这解释为已经修复 WorkBuddy 或 Node 内部的所有同步启动问题。

证据保存在已忽略的 `output/playwright/workbuddy-share-recheck/`：`desktop-doctor.json`、`desktop-doctor.jsonl`、`installed-entry-doctor.txt`、`verification.json`。后者记录来源、时间、结果及 SHA-256；原始分享另存同目录，不进入 Git。本次只归档证据、核对安装并更新文档，没有修改业务程序或配置；上轮 81 项测试作为对应代码版本的结果保留，未因纯文档变更重复执行整套测试。

## 当前状态与未覆盖范围

本轮运行环境故障复验阻塞：**无**。使用已安装技能可继续既有查询任务，不必重做环境检查或调整 PATH。新查询仍按用户当次要求执行；本次用户要求“不采集网站”，未补跑视频制作等四轮正式采集。两站当前访问、完整分页、详情及登录等业务验收未由空白页检查替代；原 P1—P6 缺口保持原状。

## 安装、文件与回滚

安装位置：`C:/Users/14629/.workbuddy/skills/tender-assistant`；绑定当前工作树及系统 Node 24.13.0。源码之外只更新该受管理技能副本，Codex 原安装绑定未迁移。README、宿主安装说明、模块说明、字段规范、技能及测试说明已同步；早期 P4 记录保留原日期，添加本记录链接。

回滚：保留用户当前配置和运行数据，恢复本次修改的源码/技能版本，再由当前工作树安装器更新 WorkBuddy 副本；不删除业务数据。当前未提交或推送。建议提交：`fix: 修复WorkBuddy采集初始化与日志捕获`。
