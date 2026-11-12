# 宁达 V3.1 合同模板审阅包（DRAFT）

此目录不是已启用正式版本。七份 JSON 的内部状态均为 DRAFT；没有向实际业务数据库写入审批、发布或签署。`samples/` 全部为合成资料，生成器只在内存构造明确标注的审批夹具。隔离测试库中的合成 LegalDocument 发布仅用于验证真实审批和准备接口。

源 ZIP SHA-256：`595a133668894fd1858e6aa67b9bbfebab5a6e38a10b71314c28d15e6dafe897`。`manifest.json` 逐件记录原始 DOCX 条目、文件和文本哈希、生成 JSON 哈希、所有刻意变换；源 DOCX 保持只读。00 是审阅说明，不是合同；02 在原 P079 拆出附件三，不属于主协议签署任务。

七个模板对应 01/SUBSCRIPTION、02-main/COOPERATION、02-grant/COOPERATION_GRANT、03/VEHICLE_SWAP、04/PRE_DELIVERY_CANCELLATION、05/RENEWAL、06/EARLY_TERMINATION。47 个标记由生成器映射为24个事实区块、4个参数、19个签署控制。正文保留固定条款、段落次序、表格和粗体警示；重排为可分页 PDF，不复刻 Word 的每个空白和分页。

审阅变换：删除各件 P003 编辑说明；02 P071 将比例审阅说明改为已确认乙方比例；P072 将单一待填期限改为逐产品版本的固定下限明细；05 保留沿用事项句，只在有实际例外时追加例外；一般签署说明和当前签署控制一起移至独立签署页，取消重复正文角色空行。所有调整仍待正式正文审批。

02 主文和独立授权样张均包含完整可阅读的01固定正文附件，保留固定条款、标题、粗体、表格及其附录；将未来逐单变量及签署控制清楚标识为未来范围，不填写客户身份或虚构签署日期。附件显示 LegalDocument 的既有系统内容哈希（`hash(content)`，即 JSON 字符串化后的 SHA-256）及原始 UTF-8 字节 SHA-256，同时 PDF 内嵌完全相同的源字节。可阅读附件是签署 PDF 本体的一部分，不依赖移动端打开 JSON 附件。独立授权还携带主协议编号、正文摘要和不可变附件一事实，不能用可变链接替代。

正式启用由既有 LegalDocument 草稿创建/确认/激活流程执行；新 DTO 支持七个 `ELECTRONIC_V31_*` 类型，激活检查结构及全部固定标记绑定。运行时从已批准 LegalDocument 内容读取完整 AST，无 `.runtime` 或 DOCX 依赖。当前实际准备仅支持01和02主文；其他类型等待各业务任务提供真实来源后接入。

重建命令（项目根目录，依赖已安装）：

```
python -X utf8 scripts/ninda/build-v31-templates.py
node apps/api/node_modules/tsx/dist/cli.mjs scripts/ninda/render-v31-samples.ts
python -X utf8 scripts/ninda/inspect-v31-samples.py
```

本机使用已核验的微软雅黑 regular/bold TTC face；生产使用已有 Noto CJK 字体及对应 bold 文件。`samples/manifest.json` 记录每份 PDF 文件哈希、页数、签章页/中心坐标；`samples/qa.json` 记录每页 PNG 哈希、字符边界检查、未完成标记检查及02完整固定正文嵌入字节检查。可阅读的逐页 PNG 位于 `samples/<artifact>/page-NN.png`，分段 contact sheet 覆盖全部页。文本/边界检查与人工视觉检查是不同证据，视觉结论见 Task3 报告。
