# 线下订单变更、纸质补充协议与交接批次

本页记录本地已实现契约及仍在接入的边界。**生产未部署，新的 OFFLINE 变更总入口尚未开放**。初始租赁合同及纸质补充协议均保持真实 `Contract.status=DRAFT, executionMode=OFFLINE`，不伪造电子签署成功或供应商任务。

## 未交付延期

沿用 `/admin/orders/:id/delivery-delay-context`、`delivery-delay-changes` 和 `/admin/order-changes/:id/:action`。当前运营创建/报价，独立财务复核，运营发布，客户以完整正文和 commercialHash 确认后进入 `AWAITING_ARCHIVE`。客户确认与新电子签开关分离；真实当前资格、原风险审核、同客户资料、实际未交付、资金事实和完整生效协议链均须有效。

`OrderChange.originalArchiveVersionId` 固定真实初始租赁签字档案；`priorTermsVersionId` 与同订单前一有效条款关联，`priorTermsHash` 是实际 priorTerms 的摘要，不等同 commercialHash。

发布只接受已审定启用的 `OFFLINE_ORDER_AMENDMENT`。`quote.snapshot.document` 为 `{id,type,version,templateHash,bodyHash,content}`；正文只插值原冻结客户/出租方/平台、实际原档案和本次报价，不从当前资料或实名供应商补造身份证明文。`offlineSource` 固定原合同、原档案版本/签字件清单摘要、先前条款、原客户资料与主体摘要。模板所需事实缺失则拒绝，不自动生成或启用法务模板。

## 纸质协议归档

新档案 `kind=ORDER_AMENDMENT, subjectType=ORDER_CHANGE_QUOTE, subjectId=quote.id`；`quoteId` 唯一 FK。`POST /admin/offline-archives` 仍带 revision/idempotencyKey/templateId，templateId 必须是客户已确认报价的模板版本。报价、真实合同、档案必须同订单/客户/出租方，正文及模板摘要必须相同。

流程保留生成 → 预览/打印确认 → 上传签字件 → 提交 → 人工审核 → **明确归档**。归档仅将对应变更从 `AWAITING_ARCHIVE` 推进到 `AWAITING_FINANCE`，不直接生效、不新增资金或核销次数。财务准备才固定 `DelayQuote.approvedArchiveVersionId`；生效条款保存相同 `OrderTermsVersion.offlineArchiveVersionId`。已经固定的纸质版失效不能借另一版本替代，已生效协议更正须另办明确变更。

初始 RENTAL 始终按初始 finalPlanSnapshot/hash 展示与校验，不改成后续条款。已生效后的付款、合同变更和结算核完整条款链；尚未生效但已准备财务的 active amendment 也必须固定档案有效才能付款。缺报价、错归属、缺 pin、归档失效均阻断。可信迟到款仍如实记录，标记 reconciliationRequired，不自动分摊或推进订单。客户页面使用同一付款判定。

## 同价换车和升级

首版已明确拒绝降级。`pricingVersion:2` 报价从真实已发布商品读取冻结价格，输入 targetListingId/targetListingRevision/targetSourceHash 和实际计划交还时间等安排；拒绝客户端覆盖月费、逐期金额或额外交接费。差价按原合同剩余租期和服务月实际天数逐期计算到分，新车实际交付日计入新车，原到期日不延长。

已实现草案只冻结报价与目标车预留，不产生账单、退款、用量或换车次数写入。保留原 TERM 和用量政策，目标商品只作本次选车/价格/保障依据。发布、资金与双侧物理交接正在后续包接入；日期变化必须重新报价和核真实净款，不能复用旧资金快照假装价格不变。

## FIELD 批次

014 增加 `batchKey/changeId/quoteId/termsVersionId`，唯一键改为 `(orderId,batchKey)`；新增三个复合外键保证 change/quote/terms 同源。四种类型为 DELIVERY、RETURN、SWAP_RETURN、SWAP_DELIVERY。

- 初次交付：`DELIVERY:<termsVersionId|INITIAL>`。
- 换车两侧：`CHANGE:<changeId>:RETURN|DELIVERY`，固定当次 quoteId。
- 最终归还：`FINAL_RETURN:<真实 assignmentId>`。
- 旧记录不能证明来源时保留 `LEGACY:<taskId>`，不按当前车补造历史，不重启已完成任务。

任务来源由服务端派生，客户端不能填写 batchKey、车辆或 assignment。改派、失权、报价/条款变化、材料代际变化会阻断旧材料写入；发布与重放仍先查当前人员和会话。换入 assignment 只在真实交付完成后形成。SWAP_RETURN 使用 RETURN_RECEIPT，但不能调用最终收车停租逻辑。

## 已确认后续范围

续期在原订单追加租期并签补充协议，按该车重新选择的已发布商品确定续期租期/月费/里程规则；原服务期不改。续期阶段重新发放赠送换车次数，原赠送到期不结转，已付费次数按原有效期保留。续期阶段模型及全链实施另立包，不能通过覆盖原 TERM 余额实现。普通交易条件变更首版暂缓。

全部变更保持整数分、当前权限、对象归属、版本冲突、事务幂等和可信支付/退款校验。测试仅统一 guard 独占本地隔离库；普通 Node 测试误构造 Db 时会在连接前拒绝。
