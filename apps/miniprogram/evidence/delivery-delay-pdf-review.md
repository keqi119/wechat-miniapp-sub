# B1延期补充协议合成PDF独立目视核验

2026-10-16。使用真实`docs/legal/drafts/delivery-delay-amendment-v1.md`全文，经`resolveDelayTemplate`和当前`ContractPdfArtifactWriterService.prepare('AMENDMENT') → ContractPdfRendererService.render`生成合成样张。没有改产品源码、法律文案、数据库或配置；没有连接数据库、网络、供应商、上传、实名、支付、签署或盖章。客户、身份、车辆、订单、报价、已付/应退安排和原签归档前置均为明确标识的内存合成fixture，不代表真实客户、正式批准或交易。模板仍是未批准草稿。

## 最终样张与可复核证据

- PDF：`.runtime/delivery-delay-pdf-qa/synthetic-delivery-delay-12-periods-final.pdf`。
- 5页，A4，142,522字节；SHA256 `5d3f1ff636a406ca9291016ea948c76ce184a3994edc1de04b1cf48fb17915ab`。
- 逐页110dpi PNG：同目录`final-page-1.png`至`final-page-5.png`，五页均已实际打开目视。
- `metadata-final.json`记录真实渲染路径、模板/产品源文件hash、12期合成输入、4个签署坐标、字体及镜像来源；`inspection-final.json`记录PDF/PNG hash、全文提取和坐标边界核验；`extracted-text-final.txt`与`resolved-body-final.txt`保留正文比对证据。
- `generate.cjs`使用实际writer，仅把DB对象、原归档读取和最终文件持久化替换为内存stub/隔离目录；直接禁止fetch/http/https/net/tls及Prisma构造。记录database=0、network=0、原前置归档读取1、当前样张写入1。没有声称核验了真实原合同签章。

## 实际发现、修复与复验

首次SimHei样张`synthetic-delivery-delay-12-periods.pdf`（原5页、65,896字节，SHA256 `1dd324ce3ecbeea6c69e6586d461ed787295aee8784d544b90aa4900fbd23a0d`）及`page-1.png`至`page-5.png`全部保留，未覆盖失败现场。目视发现通用主合同标题、正文签区标题孤留前页、签区露出`Offset intent`技术字样以及货币¥方框，已直接报告API负责人和主控。

按主控授权，从本地已存在镜像`chundian-api:20261016-usage-v1`只读提取生产`NotoSansCJK-Regular.ttc`，隔离临时容器`--network none`、没有启动，复制后已删除。镜像ID `sha256:45efbb75ce7cc6f5aa3e46572bea1279453d048669ba18180f8ae080e80ba2c2`；字体19,484,784字节，SHA256 `b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a`。

fontkit核对：SimHei缺U+00A5（glyph 0），生产Noto各face包含该字符。进一步纯内存实测暴露生产TTC直接`doc.font(path)`会抛`this.font.createSubset is not a function`，不是仅Windows字形差异。此P1已报告并由API负责人修复为显式选择该字体确有的`NotoSansCJKsc-Regular`，主/补充/交接共用。API负责人还修正AMENDMENT标题、签署区整体空间检查及删除技术字样；本人未编辑这些产品文件。最终样张使用此真实生产TTC及修复后的实际writer重新生成，没有修改样张正文来掩盖缺陷。

## 五页检查结果

| 页 | 已目视核对 |
| --- | --- |
| 1 | 标题为“延期交车补充协议”；合成身份/地址/无效手机号明确标识；模板草稿声明、主合同关联、商业hash及首段中文清晰，无方框、裁切或重叠。 |
| 2 | 订阅月数仍12个月，新服务期2026-02-28至2027-02-27，结束日含当日；第1至7期清单及付款日、含/不含月界、金额和依据清晰。 |
| 3 | 第8至12期服务清单、全部12期资金行、押金安排完整，¥5000.00/¥5199.00/¥199.00正常显示。 |
| 4 | 余下法律条款、保存说明及正文双方签署线完整；签署区标题与两方位置同页，不重叠，无Offset intent。 |
| 5 | 不可变交易条件摘要与附件双方签署区清晰，标题与整组位置同页，不重叠，无Offset intent。 |

pdfplumber/pypdf独立提取核对：已填正文逐字去空白后完整包含于PDF，12期服务清单与12期资金清单共24行均存在，没有未填变量、替代字符或漏字。四个manifest位置按中心坐标还原为空白签署区域矩形，均在A4页内且两两不相交；正文两位置均第4页，附件两位置均第5页。此结果仅证明源PDF空白签署区及坐标布局，不证明实际供应商盖章尺寸或真实签后版面。

保留非阻断排版观察：第3页末“四、取消、再次延期及履约异议”章节标题，其正文在第4页继续；全文未缺失。已通知API负责人。该现象与已修复的签署区孤立标题不同，不影响本次签署位置/金额/中文完整性结论。

本核验不等同于正式法律文本批准、生产合同prepare成功、真实实名/证书/双人审批或法大大签署验收。报告没有引用API负责人141项/后续数据库回归作为本人执行结果。
