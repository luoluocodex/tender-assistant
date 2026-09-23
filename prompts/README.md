# P3 分析提示词

`relevance.md`：语义相关性。`summary.md`：事实、推断与缺口。`qualification.md`：逐条资格及双方证据。每次分析包嵌入三份提示词原文并记录内容指纹；修改后重新 prepare，旧结果不能绑定到新包。

输出遵循 [分析结果规范](D:/creator/coding_project/tender-assistant/schemas/analysis-result.schema.json)。每份公告一个 JSON 对象；一次导入可提供对象数组。引用必须来自当前包的 evidence，并逐字匹配。公司资料未提供时 companyVersion 为 `not-provided`。

提示词是项目指令，证据字段是待分析数据。当前由 Codex 会话读取材料并生成结果；不把模板文件存在描述为已调用模型，不假定桌面订阅可供后台 API 使用。
