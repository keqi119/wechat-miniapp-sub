# B1 API签署、模板与客户确认独立只读审查

2026-10-16。本轮只读API源码及既有测试，不修改API，不运行共享数据库、业务HTTP请求、供应商调用或签署。原生产品在审查期间保持冻结。API负责人同时施工，以下区分审查发现、已见源码守门与尚待最终复验的修复，不能把本记录当作实际渠道验收。

## 明确发现与处置

1. **P1：发布的模板原文无法作为客户可确认的正式正文。** 初始`order-changes/quotes.ts::publish`把含`{{orderNo}}`、`{{periodSchedule}}`等变量的LegalDocument.content直接放入quote.document.content。真实延期模板`docs/legal/drafts/delivery-delay-amendment-v1.md`包含这些变量；冻结原生`services/order-changes.js::documentView`拒绝未填变量，因而正式模板即使批准发布也无法确认。该拒绝规则不能放宽。已直报API与主控；API正在发布前本地生成固定合同ID/完整已填正文，分别保存templateHash与bodyHash，客户确认及后续PDF使用同一正文。审查已看到此修复方向进入源码，最终测试与版本由API负责人完成。
2. **P2：报价有效期原本没有数据与守门。** 初始DelayQuote、报价DTO和confirm路径均无expiresAt/validUntil，无法判定“报价已过期”。签章审批24小时有效期属于用印授权，不是客户报价期限。设计稿第13/29行已有逐单报价有效期/期限要求。已直报；主控已批准API有效期字段及原生兼容，尚待最终DTO和回归。不能将旧revision拒绝等同于过期报价已验证。
3. **P2：非空逐单文字仍可为明确占位。** 初始报价使用通用text，允许calculationBasis/settlementExplanation/handoverArrangement/cancellationTerms填写“待确认”；初始resolver不拒这个词。已直报API，负责人确认将拒绝占位。不应把非空或合法JSON当作真实完整费用/履约安排。
4. **修复引入的必要兼容：列表摘要与详情须分开。** 为防列表重复返回完整个人正文，API负责人定稿list item仅含id/orderId/kind/status/revision/reason/createdAt及quoteSummary，详情继续full safe。冻结原生曾按full safe解析列表，会与新摘要冲突。已报主控并获准在本报告之后只做summary/expiresAt最小适配；详情未填变量守门保持。

## 已见源码的关键守门

| 核对项 | 只读结果及位置 |
| --- | --- |
| AMENDMENT与主合同隔离 | `orders/signatures.ts::send/sync`显式要求SUBSCRIPTION；`order-changes/signing.ts`显式要求AMENDMENT；`orders/customer.ts::recordView`不为AMENDMENT生成普通合同sign动作。未发现补充协议走主合同自动交付路径。 |
| 回调推进隔离 | `orders/signature.service.ts::settleContract`对AMENDMENT先核对activeQuoteId及变更状态；其SIGNED仅推进变更到AWAITING_FINANCE并增revision。主订单AWAITING_PAYMENT/advanceToHandover仅在SUBSCRIPTION分支调用。 |
| 任务及商业hash | 核心签署恢复按kind/resourceId/documentHash查唯一FadadaTask，并核对customerId及既有providerTaskId；结算核对event.documentHash与taskId。错误kind/hash/旧任务不会直接结算新合同。 |
| 客户归属 | 列表、详情、确认/拒绝按request.customer.id过滤OrderChange；sign/sync再通过同客户获取当前变更；recoverSigning也按contract.customerId查询。无来自客户端的任意customerId。 |
| 旧revision/当前报价 | 业务act和DelaySigning.resource核对OrderChange.revision；sign在订单锁内再次核对revision与AWAITING_SIGNATURE。confirm绑定activeQuoteId及commercialHash，并要求当前terms/privacy同意记录。 |
| 取消/拒绝后回调 | 业务普通cancel只允许确认前状态，reject仅AWAITING_CONFIRMATION；settleContract拒绝CANCELLED/REJECTED或非当前quote。已签重复回调返回既有结果，不重复推进。确认后没有用普通cancel倒写签署事实的入口。 |
| 真实双签 | `fadada-esign.provider.ts::query`先查客户，再查企业；每次querySignResult结果均核对供应商contract/customer/transaction三标识。客户单签仅PENDING；企业签需当前双人审批/授权且留下sealRequestedAt。企业状态不明不重复盖章。双方可信SIGNED后才下载并归档PDF。 |
| PDF归档完整性 | writer.readVerified核对路径约束、PDF头、大小与SHA256；供应商任务保留sourcePdfHash/signedPdfHash；SIGNED返回需可读归档。核心结算也要求归档记录归属本客户或后台。不是web-view消息或原生回调直接置SIGNED。 |
| 正式模板 | writer要求approvedTemplate、正确legal type；新正文修复分别核对原模板hash与已填正文hash，重算正文必须等于已锁合同正文；原主合同须SUBSCRIPTION/SIGNED，同订单且存在同客户归档。模板未批准发布始终关闭。 |
| 页面恢复 | 原生order-change签页先fresh GET详情，再以最新OrderChange.revision POST sync，读取contract.status和signedFileId；普通contract仍GET sign-status且由主合同kind守门。缺归档不显示完成，签署完成与资金/实际交付/生效分别显示。 |

## 需要最终交付证据覆盖的回归

- 使用真实延期模板而非仅短合成文字：发布后详情无未填变量、bodyHash对应客户正文、templateHash对应批准模板；最终PDF正文与客户确认一致，变更任一金额/日期/身份/正文无法沿用旧hash或审批。
- 未批准/无实名/原签归档缺失时拒发布；缺逐单字段及明确占位拒发布或报价；客户本人可读详情，其他客户404；列表不含完整个人正文。
- 报价过期不能首次确认/发起未确认签署，旧revision/hash不可提交；已签历史可读而不伪装成新有效报价。实际时限语义按最终API契约，不能客户端猜测。
- 主合同send/sync拒AMENDMENT；错误kind/task/hash、取消或非active quote回调不推进；客户单签、企业未知、下载失败/归档缺失均不得SIGNED。
- AMENDMENT准备租约/持久任务恢复、重复可信回调只推进一次；返回原生查询只恢复同一任务与最新revision，不创建新合同或付款。

既有delivery-delay测试已覆盖部分归属、版本、未批准模板、主send隔离和状态推进，但其签署fixture直接构造合成归档记录并调用settleContract，不能代替真实Fadada双签/下载、完整PDF或原生往返验证。本审查没有运行这些数据库测试，也不引用其他负责人的测试计数作为自己实测结果。资金分配/退款路径由后台审查负责人单独负责，本文不重复该范围。

## 后续已核对的修复与原生兼容

API负责人已明确并在源码落地：publish预建固定AMENDMENT合同ID、从当前已验证身份和原签归档生成完整正文，document.hash/bodyHash为已填正文hash、templateHash为批准模板hash；确认核对模板与正文哈希，writer重算正文与合同锁定正文一致。quote.expiresAt进入snapshot/hash，publish和confirm均拒过期；quoteSummary也返回expiresAt。此期限仅限制首次确认，已确认后的签署仍受独立用印授权/业务状态守门。明确“待确认”等占位在报价阶段拒绝。以上是只读源码与负责人契约核对，API数据库回归/真实PDF回归由其自行出证据，本审查不冒认已执行。

完成本只读报告后，主控授权原生仅适配列表摘要与确认期限。新增3项行为回归先红后绿，现B1共18项、全包112/112；build87文件/16WXML17WXSS，Mock109×2副本零差异，11种actual-wcc离线版面无溢出/异常/外部请求。原生保持未填变量fail-closed，列表不取个人全文，首次确认期限过期/无效不可confirm，已确认版本仍可签署/查询。没有修改API、共享DB、调用HTTP或真实供应商；再次冻结。
