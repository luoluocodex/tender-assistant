# P1 采集代码

关键词：Playwright、有头浏览器、站点适配、公告正文、Shadow DOM、固定查询窗口。

`cli.ts` 校验参数，`run/config.ts` 校验已确认配置；`run/collect.ts` 装配浏览器、查询、抽样详情和报告。公共数据类型集中在 `model.ts`。

- `run/window.ts`：北京时间自然日边界及发布日期复核。
- `run/results.ts`：来源内去重、分页签名和结束状态。P1 不持久化增量检查点。
- `run/context.ts`：访问间隔、运行预算、日志和证据输出；不保存 Cookie 或请求头。
- `sites/ccgp.ts`：页面确认的公开搜索参数、广东和深圳双地区、标题/全文、分页和 HTML 详情。
- `sites/guangdong.ts`：日期控件和分页操作，校验页面真实请求与响应。高亮摘要可能截断，用完整标题提示核对。
- `sites/guangdong-content.ts`：公告表格与封闭 Shadow DOM 正文读取，仅在公告内容容器内使用 Chromium CDP。
- `sites/fields.ts`：保守地提取编号、采购主体、金额与关键日期，保留原文。多编号返回歧义，缺失不补造。
- `sites/page.ts`：错误页识别与统一详情输出。

开发验证入口为项目根目录的 `pnpm run check`、`pnpm test`、`pnpm run build`。模型、提示词、数据库、通知发送模块按后续阶段添加，不写进站点适配器。

P1 详情完整性仅描述公告正文；不代表采购文件齐全。`buyer` 保留来源中的采购人、招标人或项目业主标签作为证据；金额和日期使用原文，不将不同标包或币种自动合并。
