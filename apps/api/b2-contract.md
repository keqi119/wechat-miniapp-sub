# B2 换车 API 契约与执行记录

2026-10-16。范围 apps/api、迁移 017；沿用 B1/H5、已批准 vehicle-change v1。B3 购买关闭。不调用真实供应商。

## 不变条件

同一订单一次只允许一个未终结变更。先旧车归还，再新车交付；物理完成时间为双方已确认的新车实际交付时间，不能用操作时间改免费周期。原始合同、原服务起止/月界、1500 km/月及里程包账户不重置。免费优先，申请/报价只预占。PAID 为独立有真实来源的类型，本轮没有购买或人工发放接口。

资金门槛本切片固定为「本次应退、押金调整、交接费用及交付所在期应收核清后交旧车」，明确展示给客户；后续月份仍按约定到期主动支付。本轮不支持双车并用、自动赔付或自动扣押金。超出原实收的赔付须人工财务处理且不能签署/完成。报价必须由不同财务人员复核；所有退款沿现有审批及真实渠道结果。

## 入口与请求

沿用既有 `order-changes` read/write 权限，动作另守 ADMIN/OPERATIONS、ADMIN/FINANCE。所有写入 strict DTO，金额整数分，日期上海自然日，ISO 时间必须带时区。变更动作均 `{revision,idempotencyKey,...}`；所有能力由服务端返回。

- `GET /admin/orders/:id/vehicle-change-context`：安全上下文，下述 context。
- `GET /customer/orders/:id/swap-account`：本人次数与当前车辆，下面 account。
- `POST /customer/orders/:id/vehicle-changes {reason,idempotencyKey}`：真实申请，无扣次、无 hold。
- `POST /admin/orders/:id/vehicle-changes {reason,expectedOrderRevision,priorTermsHash,idempotencyKey}`：运营发起。
- `GET /{admin|customer}/order-changes[/:id]`：列表增加 `kind=DELIVERY_DELAY|VEHICLE_CHANGE` 过滤；列表保持摘要，不传实名正文。
- `POST /admin/order-changes/:id/quotes`：按 kind 接收；B2 请求为 `{revision,idempotencyKey,targetVehicleId,plannedReturnAt,plannedDeliveryAt,newMonthlyFeeAmount,depositAmount,periods:[{sequence,amount,dueDate,calculationBasis}],handoverFeeAmount,handoverFeeBasis,depositBasis,insuranceResponsibility,downtimeArrangement,settlementExplanation,handoverArrangement,cancellationTerms,reason,expiresAt,externalCompensationRequired:false}`。periods 覆盖全部原订阅月；已开始更早月份金额/日期不可改，换车所在月及未来逐期明确。零额允许但依据必须明确，所有文本拒占位，金额不从文本推算。服务端推导同一期真实沿用/补付/退款，押金只从原押金真实净实收派生。hold 绑定目标车及当前 quote，不占用旧车 reservedOrderId。
- `review/publish/confirm/reject/prepare-signature/sync` 沿 B1 DTO。AMENDMENT 发起仅 H5；旧原生 sign 保持拒绝。发布要求已批准发布 `vehicle-change-amendment` 模板，冻结已填正文 `document.{id,type,version,templateHash,bodyHash,hash,content}`；列表无正文，财务/客服详情无实名正文。
- `POST /admin/order-changes/:id/prepare-finance {revision,idempotencyKey}`：创建本版本真实应收/应退；拒绝/可信失败退款可审计重提，未知不得重开。
- `POST /admin/order-changes/:id/handovers {revision,idempotencyKey,side:'RETURN'|'DELIVERY',actualAt,readingKm,fileIds,checklist:[{label,value}]}`：当前版本、真实车辆、旧侧当前 assignment / 新侧目标 hold；从报价校验实际日期/安排，变更事实必须重新出已确认版本。新侧只能旧侧完成后创建。仪表分别以各车为基线。
- 交接既有 `publish`, 客户 `confirm/object`, ADMIN/OPS `revise`, H5 签署及可信 sync 复用；SWAP 类型不会调用退订。`POST /admin/handovers/:id/complete`：旧侧只关闭旧 assignment、旧车 UNPUBLISHED、当前分配置空；新侧一次事务完成新 assignment/条款/hold/次数账本/变更 APPLIED，重复返回原结果。
- `POST /admin/order-changes/:id/complete {revision,idempotencyKey}`：仅已双侧可信签署且旧侧已完成时恢复新侧完成（与 handover complete 同函数）。
- `cancel {revision,idempotencyKey,reason}`：仅客户确认前且无未知任务/实际交接，释放 hold/次数预占。已确认未发供应商任务可重新报价；已进入渠道须可信终态才重出。任一物理侧完成后只允许同变更继续，不能伪撤销物理事实。

## 安全响应

context：`{orderId,orderRevision,priorTermsHash,startDate,endDate,months,depositAmount,periods,currentAssignment,swapAccount,canCreate,activeChangeId,blockers,capabilityNote}`。endDate 是最后服务日（含）；periods 的 startDate 含、endDate 不含；period 含 sequence/dates/dueDate/amount/netPaidAmount/billId/billStatus，不传供应商原文。

account：`{orderId,startedOn,endDate,currentAssignment,cycle:{sequence,startDate,endDate,freeAvailable,freeReserved,freeConsumed},paidAvailable:0,reservations:[{id,changeId,source:'FREE'|'PAID',cycleSequence,status}],ledger:[{id,type:'RESERVE'|'RELEASE'|'CONSUME',source,cycleSequence,changeId,actualAt,recordedAt}],canRequest,canPurchase:false,blockers}`。

assignment：`{id,vehicle:{id,title,plateNumber,vin},startAt,endAt,startReadingKm,endReadingKm,status:'ACTIVE'|'CLOSED'}`，无当前车辆返回 null（界面显示换车待交付，不能用旧 order.vehicleId 冒充当前车辆）。

VEHICLE_CHANGE detail 保留 B1 通用 id/orderId/customerId/kind/status/revision/reason/quote/history/contract/finance/can* 字段，另 `currentAssignment,targetVehicle,hold:{id,status,expiresAt},swapAccount,returnHandover,deliveryHandover,actualCompletedAt,recordedAt,canCreateReturn,canCreateDelivery,canComplete`。handover 引用 `{id,type,vehicleId,assignmentId,status,signatureStatus,actualAt,readingKm,manifestHash,canComplete}`。quote 除 B1 公共字段增加上述报价字段、`financialGate:'BEFORE_RETURN'`、服务器派生 `depositChargeAmount/depositRefundAmount`、`newStartDate/newEndDate/months` 均沿原期限。quoteSummary 添加 targetVehicleId/targetVehicleTitle/plannedReturnAt/plannedDeliveryAt，保留日期/expiresAt/hash。

## 分段用量

`GET /{admin|customer}/orders/:id/usage-account` 追加 `currentAssignment`；period 追加 `segments:[{id,assignmentId,vehicleId,vehicleTitle,startAt,endAt,startReadingKm,endReadingKm,readingId,status:'OPEN'|'REVIEW_PENDING'|'READY'|'FROZEN',revision,canSubmit,canRequestEvidence}]`。不同车辆读数绝不相减。月总 usedKm=SUM(同车段 end-start)，整个 period 只一次基础和包消费。缺任一段不结算。旧 period 的 start/endReadingKm 仍兼容历史展示，但分段月份前端不得将二者差显示为用量。

- `POST /customer/usage-segments/:id/readings {readingKm,recordedAt,fileIds,idempotencyKey}`：本人指定段的真实月界照片；初次/补证同路由；不能客户端指定 vehicle/assignment。
- 既有 `POST /admin/mileages/:id/review` 增量识别 segmentId；仍 decision/note/boundaryConfirmed。
- `POST /admin/usage-segments/:id/request-evidence {revision,idempotencyKey,reason}`：未结算、仅运营；保留旧证据。已由已签交接形成的段终点不可用普通补证覆写。
- 既有 period settle 读取全部段快照并冻结，SETTLED 不可回溯换车。旧 A 没有分配的历史记录仅从已有可信 DELIVERY/RETURN 和已核验月界重建，不推算时间/读数，缺证即阻断。

## 模板 slots

复用 AMENDMENT 身份/原合同槽：contractNo/orderNo/applicationId/originalContractNo/originalContractHash/changeId/quoteRevision/commercialHash/customerName/customerIdentityNo/customerMobile/customerAddress/months/originalStartDate/originalEndDate/newStartDate/newEndDate/periodSchedule/financialSchedule/changeReason/settlementExplanation/handoverArrangement/cancellationTerms/platformSignatureSlot/customerSignatureSlot。

新增 oldVehicleIdentification/targetVehicleIdentification/plannedReturnAt/plannedDeliveryAt/newMonthlyFee/depositText/handoverFee/insuranceResponsibility/downtimeArrangement/swapCreditRule/financialGate。所有来自冻结 quote、真实车辆身份及已批准规则；不改 15 固定来源文件。主控负责完整模板审定，未发布前 publish fail closed。

## 执行切片/验证账本

1. RED→GREEN：分配台账/分段计量、库存 hold 守门；迁移 017；已有 A 单车兼容。
2. RED→GREEN：免费周年/预占/实际完成一次扣一次，PAID 来源不可伪造。
3. RED→GREEN：真实报价/资金/已填 AMENDMENT/H5 复用，双人审批与未知状态拒绝。
4. RED→GREEN：两侧交接、无车间隔、恢复/取消、回溯已结月拒绝；服务/还车/读数改用当前分配。
5. 独立交叉审阅后针对修复，完整 API suite/build/15 来源 hash 验证，报告冻结；不提交、不部署。

进度：017 本地 dev/test 迁移完成。首批 7 个真实 HTTP 回归先红后绿，覆盖申请归属/幂等、独立仪表月汇总、同目标库存竞争、已填补充协议/H5限制、资金阶段、两侧物理完成一次消费。继续最终还车与异常/并发回归，尚未冻结。

### 已广播的 safe 补充

- 状态新增 SWAP_RETURNED；本次先旧侧完成，再新侧交付，最终 APPLIED。
- assignment 历史在 usage-account.assignments 和 swap-account.assignments；detail.originalAssignment 保留冻结旧分配关联。targetVehicle 额外 mileageKm。quote.oldVehicleIdentification/targetVehicleIdentification 是确认用冻结字符串，不从 live vehicle 重建。
- finance.adjustments 为 `{id,type:'DEPOSIT_ADJUSTMENT'|'SWAP_HANDOVER_FEE',amount,paidAmount,status,dueDate}[]`，finance.depositRefundAmount；统一 refunds 列表。
- swap reservation 状态 RESERVED/RELEASED/CONSUMED，cycle.endDate 不含。
- usage-segments 使用独立 read/write permission，ADMIN/OPERATIONS 可补证；FINANCE 不可写。
- dashboard.subscription 追加 activeChangeId/currentAssignment；无车间隔 vehicle=null，显示换车待交付。handover GET 追加 vehicleId/vehicleTitle/assignmentId/changeId。

### 2026-10-16 主控优先级调整保存点

恢复原生实名/签署切片优先，B2 当前代码不删除、不提交。最新 7 项 vehicle-change HTTP 套件绿；新增最终还车分段 1 项单独先红后绿；最新 build 通过。尚未运行全 API 套件或宣布 B2 完成。接续事项包括已签后交接日期改变的可执行重报价恢复、押金/交接费支付退款回归、周年/跨月/读数更正竞态、所有库存消费者、固定源及完整 suite。当前 017 仅本地 dev/test，禁止混入本次原生入口恢复发布。


### 2026-10-16 恢复与最终投影补充

- `detail.swapAccount` 与独立 swap-account 完整同形，包含锚点、分配历史、能力、blockers。不是仅次数摘要。
- `recoveryOnly:boolean` 表示已签后的最小恢复边界。仍使用原 quotes 接口及完整 DTO，只有 `plannedReturnAt`、`plannedDeliveryAt`、`handoverArrangement`、`downtimeArrangement`、`reason`、`expiresAt` 可以变更。目标车、金额、逐期付款日/依据、押金、期限等严格保持原已签值；旧侧已完成时 plannedReturnAt 必须等于已记录 actualAt。
- 恢复报价独立复核、客户确认、用印审批和真实签署。`quote.previousQuoteId` 保留上版关系；`recoveryFromQuoteId` 是最近已签恢复基线；`financeSourceQuoteId` 是原资金义务来源。取消/拒绝尚未确认恢复报价回到最近已签版本，保留真实无车状态及库存预留。
- 恢复签署后仍需 prepare-finance 核对，但复用原真实义务/分配/账单/退款，不重复生成。新交付所在期应收未到款仍阻断；超边界改价返回 `SWAP_RECOVERY_MONEY_IMMUTABLE`，不是人工处理完成。
- 月租补差为 `SWAP_ADJUSTMENT`；finance.obligations.chargeBillId 形状不变。押金补收及交接费继续在 finance.adjustments。
- 完整无车月只能由两端完成且已签归档的真实交接、分配台账共同确认零用量；该月 READY、segments=[]、startReadingKm/endReadingKm=null，禁止客户虚填仪表。费用仍按逐单协议，不从零用量推导免租。
- 原单车旧月读数/补证入口仅在唯一原车辆分段（非换入分配）时映射至同一分段事务；多车月份必须专属 segmentId。
- 原生签约切片在独立工作区验证发布；本 B2 变更只复用签署业务服务，后续与已发布原生入口合并后再次核验接线，不恢复无门禁旧通道。
