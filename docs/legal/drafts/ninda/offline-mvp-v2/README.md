# 三方订阅合同和终止协议第二版审阅包

2026年10月30日。本包按用户本轮要求编制；用户随后明确确认“确认两份正文及差异，制作并启用新版本”，两份v2已正式启用。本目录保留原审阅正文，正式文本及审定记录见[正式v2](../../../versions/ninda/offline-mvp-v2/README.md)。源文件只读，既有订单签字版均未改写。

两份v2已在生产后台PUBLISHED，可在“合同管理 → 模板与文案”查阅：[订阅合同v2](https://admin.evsub.ndacar.com/#legal-documents?record=cmvuhgbc2000el501suej6v3h&view=overview)、[终止协议v2](https://admin.evsub.ndacar.com/#legal-documents?record=cmvuhgcgh000gl501378x56fc&view=overview)。同类型v1转RETIRED，正文和原合同绑定保留。[启用回读核验](../../../../evidence/ninda-contract-v2-activation.json)，首次[草稿入库记录](../../../../evidence/ninda-contract-v2-drafts.json)保留历史状态。

- [三方订阅合同完整正文](rental.md)：参考 `D:/Projects/document/汽车订阅服务合同20260713.docx`，将出租人与承租人的权利义务整合为14章，并明确宁达平台职责。
- [三方终止与结算协议完整正文](termination.md)：只引用原合同名称、编号和适用条款，结合本单终止、还车、违章及结算明细生成。
- [两方版本逐项整合说明](clause-mapping.md)：列出来源、纳入位置和重要调整。

机器模板为相邻的 `rental.template.json` 与 `termination.template.json`，正文与上述文件标记区域一致。签署主体为 CUSTOMER、OWNER、PLATFORM；不将旧参考合同的公司、银行账号写入新模板。正式版本号以系统该类型已有版本为准，本包建议v2，若已存在不同内容的v2应另建下一版本，不覆盖。

原基线要求“正式模板由用户审定”；本次已取得用户明确确认，并通过模板版本启用接口完成。启用只影响新建档案；已有档案仍固定其原模板，已签订单终止时引用该单实际签署版本。未签草稿如需使用v2，选择“更换模板并建立新版”重新生成和办理。

逐单价格、期限、里程、能源、权益及提前终止/押金规则由订单已确认快照带入，运营保留按实际交易协商修改的能力。未交付不得生成已还车或已查验结论；应补、应退或保留款须明确金额、依据和相应日期。

本稿为业务整合审阅文本，正式使用前宜由熟悉汽车租赁业务的法律专业人员复核。整合时核对了[民法典合同、租赁及违约责任规则](https://www.court.gov.cn/zixun/xiangqing/233181.html)和[消费者权益保护法的格式条款要求](https://www.samr.gov.cn/zfjcj/tzgg/art/2023/art_615af9ed6bcd4974bf853dd2e02bc663.html)。
