# WorkBuddy 安装入口

用户级技能默认安装在 `$USERPROFILE/.workbuddy/skills/tender-assistant`。本次验证版本为 Windows WorkBuddy 5.5.6；程序源码和运行数据保持独立，不修改 WorkBuddy 安装缓存。

## 安装、更新和卸载

在要绑定的源码根目录执行，先按根 README 恢复项目依赖：

```powershell
& ./integrations/workbuddy/install-skill.ps1
& ./integrations/workbuddy/install-skill.ps1 -Uninstall
```

安装复用 `integrations/install-skill.ps1`，复制共用的 `SKILL.md`、`scripts/tender.ps1` 和 `references/workflow.md`，生成 `project.json` 与 `.install-manifest.json`。不复制仅用于 Codex 的 `agents/openai.yaml`，不复制 Node 依赖或业务数据。`-Destination` 可指定另一个以 `tender-assistant` 结尾的目录；该参数本身不使目录变为 WorkBuddy 的发现路径。

安装时从 PATH 找到符合 Node >=24.13.0 的运行时并将其绝对路径写入 `project.json.nodeExecutable`，也可指定 `-NodeExecutable 'C:/Program Files/nodejs/node.exe'`。本机 WorkBuddy 默认 Node 为 22.22.2，不能用于本项目；绑定后无需修改 WorkBuddy 或系统 PATH。旧安装没有此字段时仍从 PATH 查找，但包装器会拒绝不支持的版本。

更新和卸载会核对来源项目、宿主和文件哈希，拒绝覆盖手工修改、额外文件、链接路径及不属于本安装器的同名技能。卸载只删除校验通过的安装文件与空目录。中断后的不完整副本需先保留并核查；无强制覆盖参数。

本次绑定 `C:\Users\14629\.codex\worktrees\70b8\tender-assistant`。技能依赖该源码持续存在。工作树迁移前从旧位置卸载，再从新源码位置安装；新项目不可直接覆盖旧项目所有权。Codex 原安装和它的项目绑定不会被此命令改动。

两端交替分析同一运行数据前，应将 Codex 所绑定的源码也更新到包含本次契约扩展的版本：旧程序只接受 `codex-session`，无法读取今后新导入的 `workbuddy-session` 结果。本次仅做 WorkBuddy 只读实测，未产生这类真实分析结果；不要把新代码只存在于当前工作树理解为主项目已同步更新。

## 在 WorkBuddy 调用

进入“专家·技能·连接器 → 技能 → 我安装的”，确认 `tender-assistant`，可点“去试试”。也可在新对话输入 `/tender-assistant` 选择，或输入：

> 使用 tender-assistant 技能查看最近一次正式检索结果，说明查询时间、已分析数量和材料缺口。

需要新采集时可说“查询最近三天的网站开发公告”，技能将天数转换为 `collect --days 3`。允许 1～90 个自然日（含当天）；未指定时间范围才使用配置默认 7 天。超过 90 天会提示并停止，不截断或拆分查询。此参数需要技能绑定的源码已更新，详见[查询天数参数化记录](../../docs/2026-09-24-查询天数参数化.md)。

首次检查 `doctor`，再执行所需动作。使用 WorkBuddy 原生 PowerShell 工具：`& '<安装目录>/scripts/tender.ps1' results --limit 5`，不需要手动切到项目目录。本机宿主拒绝从 Bash 启动 PowerShell，应遵循此工具边界。

本机 PowerShell 工具可能只返回退出码。所有动作可用 `-LogFile '<已存在临时目录>/<本次唯一文件名>.jsonl'` 保存 UTF-8 的 stdout、stderr 和退出码，再由 Read 读取；参数放在动作之前。无需额外管道或重定向；缺少最终 `wrapper/finished` 记录说明尚未完成或中断。已有日志会在动作开始前拒绝覆盖，避免误重跑业务。

`doctor/results/queue/packet` 另可使用 `-OutputFile '<本次唯一文件名>.json'`。退出 0 才生成结果文件，例外为 `doctor` 退出 2 仍保存失败检查 JSON；不要把此文件存在视为成功。首次采集或环境异常使用：

```powershell
& '<安装目录>/scripts/tender.ps1' -LogFile '<临时目录>/doctor-<唯一标识>.jsonl' -OutputFile '<临时目录>/doctor-<唯一标识>.json' doctor --runtime-check
& '<安装目录>/scripts/tender.ps1' -LogFile '<临时目录>/collect-<唯一标识>.jsonl' collect --days 10
```

`doctor` 默认检查文件、版本、异步子进程和 Windows 用户识别；`--runtime-check` 再在独立空目录应用权限，并启动有头浏览器空白页后关闭。`collectionReadiness=local-runtime-passed` 仅代表本地运行条件通过，不含政府网站访问或登录。临时诊断文件不替代业务归档。2026-09-24 分享会话故障及当前 5.6.2 版本验证边界见[故障修复记录](../../docs/2026-09-24-WorkBuddy采集故障修复.md)。

只读查看不采集网站或新增分析。已有快照不是实时商机；分析需要实际读取证据、生成 JSON 并导入。WorkBuddy 生成的结果应填写 `provider=workbuddy-session`，实际模型未知则使用 `unknown-exact-model`。旧快照的历史 Codex 来源提示按技能兼容说明处理，不改动旧输入哈希。

本机实测安装后进入技能列表即可识别；其他版本未发现时先核对路径和技能开关，再重新进入页面或新建对话，必要时由用户重启应用。文件存在或 `doctor.ready=true` 都不代表宿主已调用或全业务验收通过。

## 调研依据与验证

- [WorkBuddy 官方技能说明](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market)：支持上传本地技能包、查找和创建技能。
- [WorkBuddy 开放平台](https://open.workbuddy.cn/en/docs/skill)：定义 `SKILL.md`、YAML 元数据及脚本、参考资料目录。开放平台上架所需的多语言介绍、作者、版本等字段，与本机用户技能加载要求分开；本次是个人本地安装，不发布市场。
- 本机 `resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/skill-creator/SKILL.md` 和 `cli/dist/web-ui/docs/cn/cli/skills.md`：确认基础结构；CLI 中品牌替换和技能解析实现用于核对本机行为，不把 CodeBuddy 路径文档直接当成 WorkBuddy 的证据。
- [本轮适配和验证记录](../../docs/P4-WorkBuddy技能适配.md)：本机识别、真实调用和合成测试分开记录。

未启用额外模型 API、外部通知、周期任务或真实公司资料入口。宿主会话本身仍适用 WorkBuddy 的额度和数据处理规则。
