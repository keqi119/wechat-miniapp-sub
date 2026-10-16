# B3 付费换车次数 API 契约

2026-10-16；接续 B2 和已合并原生签约。金额单位分。每笔固定购买本订单一次换车权益，80000 分 CNY；不接受客户端金额、数量或余额。没有自动扣款、后台手工发放、跨订单转移。仅新独立库，迁移018。

## 账户与购买

`GET /customer/orders/:id/swap-account` 和后台既有 `GET /admin/orders/:id/vehicle-change-context` 的 `swapAccount`（以及 B2 detail.swapAccount）保留 B2 字段，增加：

- `product:{id:'SWAP_CREDIT_1',quantity:1,amount:80000,currency:'CNY'}`。
- `purchaseTerms:null|{version:'SWAP_CREDIT_V1',documentId,documentVersion,hash,content}`，仅当前已发布且已批准的 `vehicle-change` 文案。全文中退订/到期失效且未用不退必须在购买前完整展示，例外依法处理。
- `purchases:Purchase[]`；`paidAvailable/paidReserved/paidConsumed/paidFrozen/paidExpired` 为次数，余额不包含冻结、已退或已到期次数。
- `canPurchase` 权威能力，`purchaseBlockers:string[]`。独立 `SWAP_CREDIT_PURCHASE_ENABLED` 默认false；开关关闭仍可读取、查询已有支付、收取可信回调及申请合规例外退款。仅实际交付后当前订阅有效且尚未最终归还可购买；无车间隔仍属于原订阅，不虚构当前车辆。
- `ledger` 保留 B2 字段，`changeId` 允许null；新增 `purchaseId?:string|null`，type新增 `GRANT/FREEZE/EXPIRE/REFUND/RESTORE`。`GRANT` 不是客户端支付成功，也不意味着冻结/到期后可消费。

`POST /customer/orders/:id/swap-credits`

```json
{"productId":"SWAP_CREDIT_1","termsVersion":"SWAP_CREDIT_V1","termsDocumentId":"id","termsDocumentVersion":1,"termsHash":"64位sha256","accepted":true,"idempotencyKey":"稳定UUID"}
```

先检查本人、当前terms/privacy、专门购买说明及金额不可改。相同键相同快照返回原购买；不同内容409；同订单允许不同键多笔各一次。返回 `{purchase:Purchase,bill:{id,type:'SWAP_CREDIT',amount:80000,paidAmount,status}}`。支付复用现有 `POST /customer/bills/:id/pay {idempotencyKey}` 与 `GET /customer/payments/:id`，只主动请求微信支付，可信query/callback到账才发放。0.01元验收不参与此流程。

`GET /customer/swap-credit-purchases/:id` → Purchase（仅本人）。

该GET只回读本地安全记录。主动查询支付时，若safe.paymentId存在且status为PENDING_PAYMENT，先调用既有 `GET /customer/payments/:id` 可信query，再回读购买和账户；无paymentId表示尚未建立渠道请求，不伪造查询成功。未知结果仍未确认。

`POST /customer/swap-credit-purchases/:id/close {idempotencyKey}` → Purchase；后台同路径 `/admin/swap-credit-purchases/:id/close`。未发起支付可撤销；有未知渠道任务先沿原 payment 查询/关单，可信关闭后才撤销，不另起支付单。不把未知状态称为已关单。

## Purchase 安全投影

`{id,orderId,customerId?,quantity:1,amount:80000,currency:'CNY',status,billId,creditId?,paymentId?,acceptedAt,createdAt,paidAt?,expiresOn,terms:{version,documentId,documentVersion,hash},bill:{id,type,amount,paidAmount,status},refunds:[{id,amount,status}],reservedChangeId?,consumedChangeId?,canPay,canClose,canRequestRefund,manualReviewRequired,statusMessage}`。

`expiresOn` 为最后服务日（含）；内部截止为下一日上海00:00。订单结束/归还后不能支付。status：`PENDING_PAYMENT/ACTIVE/CONSUMED/EXPIRED/PAYMENT_REVIEW/REFUND_PENDING/REFUNDED/VOID`。`PAYMENT_REVIEW` 表示真实晚到款已记账、可用次数为0、需核账和例外退款；绝不删除收入或伪作未收款。`REFUND_PENDING` 包含失败/未知退款仍冻结，具体状态读refunds；仅可信成功变REFUNDED。

GET不得返回openid、prepay、支付参数、供应商原文或身份信息。客户投影不含customerId；后台可含以便核对归属。

## 后台与退款

`GET /admin/swap-credit-purchases?page=1&pageSize=12&status=&keyword=` → `{items,total,page,pageSize}`；keyword匹配购买/订单ID。`GET /admin/swap-credit-purchases/:id` → Purchase。resource为 `swap-credit-purchases`；各已有后台角色可读，仅ADMIN/FINANCE可close。退款仍是原 `POST /admin/refunds {paymentId,amount:80000,reason,idempotencyKey}`，另一名财务/ADMIN `approve` 后走可信渠道，原 `reject/sync/retry` 沿用。

仅完整未用且未预占一次可全额例外退款。申请时同订单锁冻结，审批再次核验；拒绝/失败/未知不自动释放可消费次数，可按实际失败或拒绝记录重新申请独立复核，处理中只能查原退款。已消费、部分金额、预占中明确409。不能因普通退订自动退款。

`POST /admin/swap-credit-purchases/:id/restore {refundId,reason,idempotencyKey}`：仅ADMIN/FINANCE且`safe.canRestore=true`；refundId为`safe.restoreRefundId`。所有原支付退款必须均REJECTED、从未approvedBy/渠道退款编号，原款真实成功80000、原credit未用未预占、订阅仍有效。仅显式恢复同一credit并追加RESTORE审计流水，不新发次数。缺少原记录、过期、消费、预占、未知/FAILED/PROCESSING或曾审批发送渠道均拒绝。safe新增`canRestore:boolean,restoreRefundId:string|null`，客户二字段固定false/null。重复键不重复恢复，改理由冲突。

## 并发与实施顺序

1. 先以HTTP红测试覆盖购买同意/金额/归属/幂等，再迁移018独立购买快照与credit状态，接可信到账一次发放。
2. 发放、预占/实际消费、退款冻结、最终归还、到期清理使用同一订单锁；实际完成日免费优先，不因购买改变原期限/月里程或归还事实。
3. 晚到可信款保留Bill/Payment到账、建立冻结来源及审计，退订核清因此阻断；若原结算已完成，重开待核账而非仍报告全部核清。
4. 前端按safe能力显示，同意默认不选；失败重试同业务键，查询原payment，禁止本地增加次数。最后串行完整API测试+前端交叉审阅。
