# WorkBuddy 审查修复

日期：2026-09-28。任务类型：宿主集成、分析输入及日志边界修复。

## 变更

1. `scripts/tender.ps1` 与新增 `scripts/process.ps1`：双流按字符块并发读取，实时转发，未换行的登录提示不会等到退出才出现。`archive --auth/--manual-download` 保留调用控制台和 stdin；人工接管事件实时记录为固定 `needs-human`。不在日志复制事件中的 URL、文件名称或指令文本。
2. `packet` 每页提供原快照的 `rules`；相关性提示词依据 `rules.keyword/region/excludeKeywords` 判断，不再固定网站开发。新证据包自动获得新提示词指纹。旧快照、已导入结果及哈希不改写，旧提示词的业务示例服从包内规则；技能工作流同步这一兼容约定。
3. `-LogFile` 仅保留阶段、输出长度、固定事件及退出码，不复制正文、模型材料、URL 或错误原文。完整 stdout 使用 `-OutputFile`，完整 stderr、编译失败信息和包装器异常使用新增 `-ErrorFile`；用 .NET 在独占创建文件时原子应用仅当前用户/SYSTEM 的 ACL，不改变父目录权限，不覆盖已有文件。

## 接口与操作

- 所有文件参数放在动作之前，使用已存在目录中的唯一新路径。分析结果优先位于对应 P3 任务的 `session-output/`，不写入 Git。
- `doctor/results/queue/packet` 退出 0 保存 JSON；doctor 退出 2 仍保存失败检查。其他阶段各退出码均保留 stdout，可能是多行 JSON 或文本。`-ErrorFile` 可以为空；不能以任一文件存在证明业务成功。
- 结果/错误路径与日志路径重复、已有文件或 ACL 创建失败均在业务调用前拒绝。只读动作失败不留下可误用的结果 JSON；完整输出不再依赖日志的 `text` 字段。
- 人工登录保持可输入的终端，按提示输入 done/cancel。宿主工具不能交互时由使用者在交互终端执行，不用日志代替实际输入。没有本次 `wrapper/finished` 表示尚未完成或中断。
- Windows PowerShell 5.1 和 PowerShell 7 使用对应 .NET 文件 ACL API；脚本保存为带 BOM 的 UTF-8，避免 Windows PowerShell 5.1 按本地代码页误读中文注释。

## 验证与限制

回归使用 `output/playwright/tests/` 下的合成输入，不访问政府站点、不写正式归档、不启用模型调用或通知。验证包含实时提示后输入 done/cancel、双流与参数边界、失败/部分完成退出码、输出文件 ACL、日志不含合成敏感材料，以及不同业务快照与历史指纹兼容。

- `pnpm test`（含 TypeScript 构建）：最终 **84/84 通过**。第一次全量运行的两条旧安装断言仍要求拒绝阶段 `-OutputFile`，已随接口更新；未修改的锁竞争用例曾偶发失败，单独复验及最终全量回归通过，没有改动锁实现。
- Windows PowerShell 5.1 下完整包装器回归通过；PowerShell 7 下 `help` 输出文件及实际 ACL 验证通过。源码技能的 skill-creator 校验通过；复用已有本地 PyYAML 验证环境，没有安装新依赖。
- 已通过受管理安装器更新 `C:/Users/14629/.workbuddy/skills/tender-assistant`，保留当前工作树和系统 Node 绑定。5 个安装文件的清单哈希全部匹配，4 个技能源文件与安装副本逐字节一致；Codex 的另一项目安装绑定未迁移。
- 安装入口在当前 Codex 命令环境执行 `doctor --runtime-check`，退出 0、ready=true，子进程、Windows 身份、目录权限、有头空白页四项 passed；日志以 wrapper/finished/0 结束。只打开并关闭本次空白页，没有访问政府站点。
- 证据位于已忽略的 `output/playwright/review-workbuddy/`：`fix-tests-final.txt`、`fix-installed-verification.json` 及其引用的独立输出目录。

真实网站登录、WorkBuddy 桌面对话交互以及模型语义准确率未在本轮复测，不由合成测试和 Codex 命令环境调用替代；原 P1—P6 未验收项保持原状。代码修复阻塞：无。

## 文件清单

- 入口与进程：修改 `skills/tender-assistant/scripts/tender.ps1`，新增同目录 `process.ps1`。
- 分析范围：`prompts/relevance.md`、`src/assistant/views.ts`。
- 回归：`test/unit/skill-wrapper.test.ts`、`assistant.test.ts`、`skill-install.test.ts`。
- 使用与协议：`README.md`、`integrations/workbuddy/README.md`、`schemas/README.md`、`src/assistant/README.md`、`test/README.md`、技能 `SKILL.md` 与 `references/workflow.md`。
- 阶段记录：新增本文；09-24 WorkBuddy 采集故障记录补充后续变更链接，原实测结果保持历史语境。

## 回滚

恢复本轮涉及的源码、提示词、技能和说明，再通过当前工作树的安装器更新 WorkBuddy 副本；保留用户配置与运行数据。没有数据库迁移。普通日志内容协议改变，依赖原 `text` 解析 stdout 的调用方需要改读受限结果文件。

建议提交：`fix: 修复WorkBuddy人工接管与分析日志边界`。
