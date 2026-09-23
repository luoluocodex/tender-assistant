# Codex 安装入口

源码包在 `skills/tender-assistant/`；安装副本默认位于 `$CODEX_HOME/skills/tender-assistant`，未设置时为 `$USERPROFILE/.codex/skills/tender-assistant`。本机实际使用该可用技能根目录，版本化源码和宿主副本分开。

```powershell
& ./integrations/codex/install-skill.ps1
& ./integrations/codex/install-skill.ps1 -Uninstall
```

可用 `-Destination <绝对技能目录>` 指定其他技能根目录，最后一级必须叫 `tender-assistant`。例如另一个环境按官方文档使用 `$HOME/.agents/skills/tender-assistant`；不要同时在两个根安装同名技能。安装生成 `project.json` 绑定源码目录和 `.install-manifest.json` 记录每个文件的 SHA-256；不包含运行数据、凭据或项目依赖。

更新前检查所有受管理文件，存在手动修改、额外文件、链接路径或其他项目所有权时拒绝。修复或移动自己的修改后重试，不提供强制覆盖选项。安装中途磁盘故障可能留下不完整副本，安装器会拒绝将其当成干净安装；先保留并核验副本，再人工恢复。源码工程移动后需按新路径重新安装，旧所有权不自动迁移。

卸载只删除校验通过的安装包文件和空目录，保留源码、运行数据库、附件及结果。适用于 Windows PowerShell 5.1；通过 .NET SHA-256，避免依赖额外 PowerShell 模块。`scripts/tender.ps1` 从 PATH 选择第一个 Node 应用，检查项目并通过项目锁定的 TypeScript 编译；不全局安装依赖。

官方技能说明列出用户 `.agents/skills` 和仓库 `.agents/skills`，并说明新技能通常自动发现，未出现时可重启宿主。此处默认 `.codex/skills` 根据当前会话的 skill-creator 指引及已加载个人技能根目录选定；不推断所有版本行为相同。[官方说明](https://learn.chatgpt.com/docs/build-skills)、[技能结构](https://developers.openai.com/plugins/build/skills)（2026-09-23 查阅）。

本轮没有重启 Codex，也没有创建新任务测试自动选择。明确的路径调用已验证；自动发现状态见 P4 记录。WorkBuddy 尚未注册，可复用同一统一命令，仍需该宿主独立适配和验证。
