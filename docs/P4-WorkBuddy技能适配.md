# P4 后续：WorkBuddy 技能适配与实测

日期：2026-09-24（Asia/Shanghai）。任务类型：宿主集成、兼容修复、文档与测试。用户明确授权适配、安装到本机 WorkBuddy，并验证实际识别与调用。没有提交或推送 Git。

同日后续采集分享出现 `spawnSync whoami EBUSY` 和日志缺失，已修复业务程序的同步依赖并补齐默认安全配置下的 WorkBuddy 桌面复验：四项本地运行检查 passed。以下保留早期 5.5.6 只读验证事实；新增修复、当前 5.6.2 证据及正式采集未重跑的边界见[采集故障修复记录](2026-09-24-WorkBuddy采集故障修复.md)。

## 1. 结果与范围

已安装到 `C:\Users\14629\.workbuddy\skills\tender-assistant`。WorkBuddy **5.5.6** 的“技能 → 我安装的”实际显示 `tender-assistant`，详情可读取技能正文；通过“去试试”建立“验证招标助手只读调用”对话，实际调用 Skill、PowerShell 和 Read 完成环境检查及前三条正式结果读取。

最终复验返回 Node **24.13.0**、`ready=true`、`nodeSupported=true`。WorkBuddy 返回的结果 JSON 与项目独立 CLI 完全相同。此次是**技能识别和只读调用验收通过**，不是两站采集、真实登录或完整业务验收。未新采集、下载附件、导入真实模型分析、发送通知或创建周期任务。

## 2. 官方和本地调研依据

2026-09-24 查阅：

- [WorkBuddy 官方技能说明](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market)：技能页面支持导入本地包、查找、创建及管理已安装技能。
- [WorkBuddy 开放平台技能结构](https://open.workbuddy.cn/en/docs/skill)：`SKILL.md` 使用 YAML 元数据与 Markdown，配套 `scripts/`、`references/` 等目录。市场上架字段要求不等于本机个人技能的最小加载要求；本次未发布市场。
- 本机安装根：`C:\Users\14629\AppData\Local\Programs\WorkBuddy`。只读查看其 `resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/skill-creator/SKILL.md`、`cli/dist/web-ui/docs/cn/cli/skills.md` 和 `cli/dist/codebuddy.js`，核对技能解析与品牌替换逻辑。未修改安装文件、缓存或全局设置。
- 本机已有 `.workbuddy/skills`；安装后被应用加载，且 Skill 工具实际返回该目录作为 base directory。以此证明本机发现路径，不用 CodeBuddy 文档的 `.codebuddy/skills` 推断所有 WorkBuddy 版本。

## 3. 实测发现及修复

| 问题 | 实测证据 | 最终处理 |
|---|---|---|
| 宿主 Node 优先级 | 首轮 doctor 使用 WorkBuddy 自带 22.22.2，`ready=false` | 安装时绑定已验证的 `C:\Program Files\nodejs\node.exe`；包装器执行前拒绝低于 24.13.0 的版本 |
| 命令工具边界 | WorkBuddy 拒绝从 Bash 启动 PowerShell | 技能明确使用宿主原生 PowerShell 工具，不修改安全设置 |
| 标准输出缺失与中文乱码 | 本机 PowerShell 工具仅回传退出码；早期管道转存出现乱码 | 新增只读 `-OutputFile`；原生输出按 UTF-8 解码并写新文件，Read 工具读取；不覆盖旧文件，不用旧输出冒充成功 |
| 模型来源固定 Codex | 原校验器、schema、提示词只接受 codex-session | 新增 workbuddy-session，保留旧结果；旧快照不重写，当前来源按实际宿主填写 |

第一轮宿主读取结果时绕过了版本不满足的判断；最终包装器已阻断不支持的运行时，WorkBuddy 复验也明确纠正该结论。首轮 WorkBuddy 自动写了一份本次验证任务的本地工作日志，已追加复验订正；未改动用户原有任务或业务归档。

## 4. 安装与接口变化

源码仍在 `skills/tender-assistant/`。新增公共安装器 `integrations/install-skill.ps1`；Codex/WorkBuddy 入口只决定宿主和默认目录。WorkBuddy 安装包含 3 个共用技能文件、生成的 `project.json`，另有所有权/哈希清单；不复制 `agents/openai.yaml`。Codex 旧清单没有宿主字段时按 Codex 兼容，原有安装副本与项目绑定未自动迁移。

生成绑定新增 `targetHost` 和 `nodeExecutable`，保持 `schemaVersion=1` 和旧字段兼容。安装器新增可选 `-NodeExecutable`。更新、卸载仍拒绝手工修改、额外文件、链接路径、跨项目/跨宿主覆盖。卸载不删除源码和业务数据。

包装器新增 `-OutputFile`，仅支持 `doctor/results/queue/packet`。目标父目录必须已存在，目标文件必须不存在；命令失败不生成结果文件。普通 stdout 调用和原阶段参数保留。`--prepare` 输出的 `modelInvocation` 从 `manual-codex-session` 变为 `manual-host-session`，新增 `supportedProviders`；结果 `provider` 枚举扩展为 Codex/WorkBuddy。新准备证据包的提示词哈希会变化，已有快照不重算。

本次绑定当前工作树 `C:\Users\14629\.codex\worktrees\70b8\tender-assistant`，运行数据仍为 `C:\Users\14629\AppData\Local\TenderAssistant`。**删除工作树前先卸载并从保留的源码位置重新安装**。安装包不是独立运行程序，不能只迁移技能目录。具体命令见 [安装说明](../integrations/workbuddy/README.md)。

Codex 本机安装仍绑定原主项目 `D:\creator\coding_project\tender-assistant`。本轮未自动把工作树代码复制回主项目；在两端交替分析同一数据前，须让 Codex 绑定源码也包含本次 provider 契约扩展，否则旧程序无法读取新 WorkBuddy 分析。本次没有新增此类真实结果，不影响现有快照读取。

## 5. 最终实测与证据

WorkBuddy 对话 ID：`d8872802-2146-4ec9-b3fa-534c7b24b90b`；标题“验证招标助手只读调用”。界面选择的模型显示为 `Deepseek-V4.1-Flash`，本轮只解释已有结果，没有把该标签登记成新的业务模型分析。

最终实际链路：重新读取安装后技能/绑定 → 原生 PowerShell 执行 `doctor` 和 `results --limit 3`（各用独立 OutputFile）→ 两个命令均退出 0 → Read 读取 UTF-8 JSON → 对话反馈。

| 指标 | 当前实测 |
|---|---|
| 快照 | p3-e4a64e54dcd8b04f34081fcc |
| 用途 | formal，历史快照 |
| 候选 / 已分析 / 待分析 | 488 / 4 / 484 |
| 初判相关 / 不相关 / 待复核 | 0 / 2 / 486 |
| 展示与分页 | 3 条，offset=0，nextOffset=3 |
| 查询完整性 | 展示项 queryComplete=false；不宣称全量采集 |
| 通知 / P3 验收 | preview-only-not-sent / false |

证据位于已忽略的 `output/playwright/workbuddy-integration/`：`recognized.txt`、`workbuddy-tool-evidence.json`、`workbuddy-doctor.json`、`workbuddy-results.json`、`workbuddy-final-ui.txt`、`tests-final.txt`。仅提取本次任务相关的工具记录，不复制账户设置、完整日志或凭据。摘要和 SHA-256 见 [机器记录](P4-WorkBuddy-verification.json)。

验证命令与结果：

- `pnpm install --frozen-lockfile --ignore-scripts`：按原锁文件恢复依赖，无新增依赖。
- `pnpm run check`、`pnpm run build`：通过。
- `pnpm test`：**69/69 通过**，包括两宿主含空格路径、任意目录调用、Node 绑定、UTF-8 输出、失败/覆盖保护、旧清单、卸载及跨宿主防护。
- 合成分析测试：WorkBuddy 与 Codex 结果共同导入、来源保存、重复导入复用、无效来源及伪造引文拒绝。合成数据仅写入 `output/playwright/tests/`。
- skill-creator `quick_validate.py`：源码和最终安装副本均通过；复用本机现有 Python 与已隔离的 PyYAML，未添加产品依赖。
- 最终安装哈希、宿主实际 JSON 与独立 CLI 一致性、Markdown/JSON 引用检查和 `git diff --check`：通过。

## 6. 未覆盖项、回滚与交付

无本轮安装或只读验证阻塞。未独立验证不点名技能的自动意图选择、WorkBuddy 发起的新采集/登录、真实分析导入、交互式认证及跨日运行；这些不由脚本或合成测试的成功替代。P1—P6 原业务缺口继续保留。

回滚：用当前工作树的 WorkBuddy 安装器 `-Uninstall` 移除受管理副本，再回退本轮代码/文档。未来若已写入 workbuddy-session 分析，回退到旧校验器会拒绝读取该来源，须先保留并评估兼容；本轮未产生此类真实业务结果。历史公告、附件、数据库和结果不随代码回滚删除。

新增/修改文件包括安装器、共用技能源与包装器、分析契约/schema/提示词、相关测试、README、AGENTS、安装说明和 P3/P4/总体方案/维护文档。文档与测试均已同步。建议提交信息：`feat: 支持WorkBuddy招投标技能安装与调用`。
