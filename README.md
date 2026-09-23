# 招投标信息助手

项目目录：`D:\creator\coding_project\tender-assistant`。

首轮目标是在广东省公共资源交易平台、中国政府采购网上，检索广东地区最近 7 天的“网站开发”相关公告。使用 Codex 作为主要入口，手动触发，只生成通知预览。

当前阶段为 P0：范围、配置、环境基线和验收口径准备。采集、附件下载、AI 分析和通知程序尚未实现。

## 文档与配置

- [P0 执行记录](D:/creator/coding_project/tender-assistant/docs/P0-范围与环境确认.md)：已确认事项、环境结果、站点能力和 P1 准入条件。
- [执行方案](D:/creator/coding_project/tender-assistant/docs/招投标信息助手执行方案.md)：P0—P6 的总体实施计划。
- [首轮配置基线](D:/creator/coding_project/tender-assistant/config/p0-baseline.json)：网站开发、广东、最近 7 天、手动、通知预览。
- [站点能力登记](D:/creator/coding_project/tender-assistant/config/sites.json)：区分前期浏览观察和独立采集程序尚未验证的能力。

两个 JSON 文件用于记录已确认的配置和验证计划，当前没有读取它们执行采集的程序。

## 环境准备

本机基线为 Node.js 24.13.0、pnpm 10.28.1。Playwright 固定为 1.63.0；依赖由 `pnpm-lock.yaml` 锁定。

重建项目依赖：

```powershell
Set-Location -LiteralPath 'D:\creator\coding_project\tender-assistant'
pnpm install --frozen-lockfile --ignore-scripts
```

本命令只安装依赖，不开始采集，也不代表浏览器已启动或目标网站已验证。P1 根据已记录的浏览器路径和实际启动结果决定是否安装对应浏览器。

## 数据位置

源码、提示词和配置示例保存在项目目录；运行数据默认使用 `C:\Users\14629\AppData\Local\TenderAssistant`。该数据目录在 P0 不创建，首次写入前仍可调整。

实际账号、Cookie、令牌、公司资料及通知凭据不得放入仓库。首轮不接入公司资质资料，不选择付费模型 API，不创建定时任务，不实际发送通知。

## 下一阶段

P1 将编写最小站点脚本，验证关键词、广东地区过滤、日期范围、分页和正文完整性。当前没有 `collect`、`analyze` 等可运行命令；目录示意中的业务模块将在对应阶段按需创建。
