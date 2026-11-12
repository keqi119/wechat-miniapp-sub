# 完整补充协议打印样张

本目录是合成审阅资料，未批准、不可直接签署。PDF 首张为外部审阅封面，其后为真实生产打印器输出，另仅在页顶空白边距叠加合成审阅标识。没有修改四份正文、加入新条款、签字、盖章或填写日期。

## 读取

打开 index.html 查看四份 PDF 和每页 PNG。source-index.json 记录正文哈希、页数、签署主体及来源、PDF 和逐页 PNG 的 SHA-256。

| 样张 | 文件 | 总页数 / 打印器正文页数 |
|---|---|---|
| 01 · 未交付延期 | delay.pdf | 4 / 3 |
| 02A · 同价换车 | swap-same-price.pdf | 4 / 3 |
| 02B · 升级换车 | swap-upgrade.pdf | 4 / 3 |
| 03 · 同车续期 | renewal.pdf | 5 / 4 |

## 来源与边界

- 延期、同价换车、升级换车、续期正文逐字等于 ../review-samples/source-facts.json 四份冻结 document.content，应用 bodyHash 及原始 UTF-8 SHA-256 均匹配。正文最终 PDF 文本提取亦作完整核对。
- 新临时脚本复用原 generate.ts 的实际 publisher 和内存业务命令流程。实际 ArchiveContextService.resolve → resolveAmendmentContext → buildOfflinePrintModel → renderOfflineDocument 生成完整打印版。未构造 Db、未连接数据库、未调用外部网络或网关。
- 三方姓名均直接取真实合成夹具 order.finalPlanSnapshot.partiesSnapshot：承租人“原签约客户”、出租方“原出租方”、平台服务方“平台主体”。这不是对真实主体名称的替代或正式身份确认。
- 为满足续期纸档来源校验，新脚本在首次报价前复用已有 renewalPaperFixture 的通知标题适配（“本单出租方资料提供告知”）。不修改中央 fixture、生产或原 source-facts；完整重新生成内存来源与摘要，正文仍完全一致。新打印源摘要是此次完整合成上下文的摘要，不冒称是旧包的真实商业审批。
- 原合同编号来自已验证的原 RENTAL ArchiveVersion.contractNumber；补充协议打印编号为明确的 SYNTHETIC-AMENDMENT-* 合成编号，正文与页眉一致。内部合同 ID 不充当纸质合同号。此生产修复独立封存于 tmp/admin-amendment-print-number-baseline。
- 中文字体：本机 C:/Windows/Fonts/Deng.ttf。PDFKit 嵌入字体，Poppler 以 110 dpi 将全部最终 PDF 页渲染为 PNG。签署栏与页脚检查覆盖每页，不只核对 HTML。
- 原草案、原 HTML 12 产物、source-facts.json 和原生成脚本未覆盖。原正文仍含其冻结取消及异常说明；本包不把后来确认的取消规则补写进旧正文。
- 这是版式与内容审阅样例，不是完整真实纸档/客户确认/资金流程 E2E。所有审核、原档案和客户确认只发生在标明的纯内存合成夹具中，未新增或伪造真实审批事实。

打印器正文保留 Markdown 源的 # / ## 标识（按现 renderer 原样输出）；本包不擅自替换生产排版或改写正文。打印器页脚的“第 n / m 页”不包括外部封面。

## 全页视觉审阅

17 页最终 PDF 均已转 PNG 并逐页查看。三方空白签署框、姓名、日期栏及全部页脚完整可读，无缺字、遮挡或裁切。实测 SimHei 缺少 U+00A5（¥），故本包选用四份正文全部字符均受支持的本机等线 Deng.ttf；没有将 ¥ 改成其他正文字符。

已向主控报告的现有排版限制：同价及升级样张的打印器正文第 1 页末为“一、本次变更事实及安排”标题，段落从第 2 页开始。标题未丢失，正文完整；本包保留真实 renderer 行为，不隐藏重排或擅改生产。Markdown # / ## 原样打印同样保留。这是合成审阅包，不作为正式模板排版批准。
