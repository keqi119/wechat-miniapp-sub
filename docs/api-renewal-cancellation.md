# 未开始续期取消 API

2026-10-31：实际 `createApp` 已注册，隔离库真实 HTTP 验证通过；未部署，未发生真实支付/签章。基地址 `/api`。所有金额为整数分。

双方真实同意取消的时间必须早于上海新服务期起日零点；运营核实和退款/归档可以更晚。新期已激活或已有使用记录不适用。创建时间、原续期签字、发起退款都不替代双方约定。首版全退新增续期实收，不收取消费，原期和原押金不改。

## 新报价的固定取消约定

`renewal-context`（eligible=true）和续期只读报价预览返回服务端 `cancellationTerms`。现有提交字段仍须符合严格 schema，但服务端在构建新报价时统一替换为固定全退无费条款，参与 source/preview/body 冻结。PC 只读展示，不再允许运营自由填写不同取消收费。预览与当前 context 规则不一致须重新读取。

历史已确认报价、正文和 hash 不改。旧未确认 DRAFT/REVIEWED/PUBLISHED 报价在复核、发布或客户确认时若来源与固定政策不同，返回 `RENEWAL_SOURCE_CHANGED`；不能在后台直接改原正文。尚未过期且已发布的旧报价需先取消未确认草案，再按当前规则新建办理。

## 四入口只读摘要

后台及客户续期列表/详情的 `cancellation` 为 `null` 或严格 `{id,status:'OPEN'|'COMPLETED',completedAt:null|ISO}`。不包含互认证据、签字文件、资金快照或渠道号。OPEN 时本续期所有报价、复核、发布、取消草案、确认/拒绝、财务准备、排期及激活能力均为 false。

客户账单详情使用 `GET /customer/records/bills/:id`。取消中的本续期账单不返回 pay action；完成取消的精确关联 VOID 账单仍可查询历史，但不能付款。其他 VOID 账单不因此开放。`GET /customer/orders/:id/workspace` 的各 `billing[]` 含独立 `canPay` 和 `cancellation`，合法原期账单保持可支付，全单 `capabilities.canPay` 不能替代逐笔判断。小程序支付前重新 GET 当前账单并复核当前客户会话；未知付款结果仍沿用原请求键。

合作商订单 workspace 的 `futureRenewals[]` 可含 OPEN 摘要；完成后转入 `cancelledRenewals[]`，原当前服务期不变。查询仍要求原订单有效的资料共享授权和当前账号范围，新增续期同意不代替原授权。取消核实原件不进入合作商 DTO。FIELD 不因续期或取消自动生成交接任务。

## 权限与并发

ADMIN/OPERATIONS 可核实约定和签署、办理纸档并完成取消；ADMIN/FINANCE 可发起专用全退。退款执行仍须不同实际员工复核，不能切换同一人的别名账号。SUPPORT/FIELD 无专用取消权限；客户和合作商只读安全状态，不接触取消核实原始材料。

当前会话、authVersion、岗位在旧请求回放前仍检查。后台写请求必须有允许 Origin、Cookie 会话和 X-CSRF-Token。命令先锁 Order，再按 account/stage/change/quote/case/bill/payment 顺序核查；事务幂等和 CAS 不省略。成功返回 receipt 后用 GET 重读，GET 失败不得另发同业务新键。

下表 `id` 是续期 OrderChange ID。公共输入 `C = {revision,orderRevision,previewHash,idempotencyKey}`；已有取消案输入 `E = C + {cancellationId,cancellationRevision}`。revision 不能互换；previewHash 必须来自本次实时预览。所有 schema 严格拒绝多余字段，包括退款 amount。

| Method | `/admin/order-renewals/:id` 后缀 | 岗位与输入 |
| --- | --- | --- |
| GET | `/cancellation-preview` | ADMIN/OPERATIONS/FINANCE；当前取消、期间、版本、签署状态、互认时间、资金摘要、blockers/previewHash。运营可读证据 ID/备注；财务可读逐笔实收。两者都不返回原始 source、渠道号或合同全文。COMPLETED 返回历史完成摘要，未返回的互认字段不得当作“未核实”。 |
| POST | `/cancellation/open` | 运营；`C + {reason,mutualAgreement?}`。可选 mutualAgreement 为 `{mutuallyAgreedAt,evidenceFileIds,note}`。起日后创建必须同次提交并核实期前约定。 |
| POST | `/cancellation/confirm-agreement` | 运营；`E + {mutuallyAgreedAt,evidenceFileIds,note}`。带时区 ISO 日期、真实期前时间、当前经办人私有证据；一次记录不可静默覆盖。 |
| POST | `/cancellation/verify-signature` | 运营；`E + {signatureState:'SIGNED'|'UNSIGNED',evidenceFileIds,note}`。证据追加保留；存在历史签字件时不能声明 UNSIGNED。 |
| POST | `/cancellation/refunds` | 财务；`E + {paymentId,reason}`。服务端计算本阶段可信实收的剩余全额，只建 PENDING_APPROVAL。 |
| POST | `/cancel-prepared` | 运营；`E + {reason}`。核实双方约定、真实签署/纸档、净实收零、无未决状态与独立 REFUNDED 核账后完成。 |

记录双方约定与记录签署是两项独立核实，退款和完成都需要双方约定。OPEN 暂停此续期的新付款、财务准备、排期和激活。真实迟到 SUCCEEDED 仍入账并标记 reconciliation；待核账或仅申请退款不等于可完成。完成 pin 精确取消纸档，保留原合同、报价、付款/退款及完成证据，只将本段 VOIDED、本段未付账单 VOID；原账户、assignment、原期和条款不改。

## 取消纸档

复用 `/admin/offline-archives`，创建 `{kind:'RENEWAL_CANCELLATION',subjectType:'ORDER_RENEWAL_CANCELLATION',subjectId:cancellationId,templateId,revision:0,idempotencyKey}`。使用独立正式批准的 `OFFLINE_RENEWAL_CANCELLATION` 模板，必含 `{{cancellationFacts}}`、`{{refundPolicy}}`。模板可用字段仅 customerName、ownerName、platformName、originalContractNumber、cancellationReason 及上述事实组；开发草稿不自动发布。

流程仍为建档、预览/生成、确认打印、上传实际签字件、提交审核、审核通过、显式归档。SIGNED 完成要求精确 quote/source/body/template、原合同号、三方签署核对及完整文件 manifest；单独归档不会自动 pin 取消案、退款或完成。UNSIGNED 仍核实全部历史没有签署证据。

## 已完成取消的原付款迟到

以下仅 ADMIN/FINANCE 可用；不是重开取消案，也不是自由退款。

| Method | `/admin/order-renewals/:id` 后缀 | 契约 |
| --- | --- | --- |
| GET | `/cancellation-late-payments?page=1&pageSize=20` | page 1–1000000，pageSize 1–100；验证全阶段事实后按付款 ID 稳定分页，返回 `{changeId,cancellationId,cancellationRevision,orderId,orderRevision,stageId,page,pageSize,total,blockers,items}`。 |
| GET | `/cancellation-late-refund-preview?paymentId=` | 精确核对选定付款；返回案例/订单版本、paymentId/billId、amount、status、completionStatus、eligibleLateReceipt、receivedAmount/refundedAmount/remainingRefundAmount、reconciliationRequired、pendingRefundIds、blockers、previewHash。completionStatus 是原付款在完成快照内的状态。 |
| POST | `/cancellation/late-refunds` | 严格 `{cancellationId,cancellationRevision,orderRevision,previewHash,paymentId,reason,idempotencyKey}`；不接受 change revision 或 amount，只建剩余实收全额 PENDING_APPROVAL，CAS Order 并记审计。 |

分页 item 仅 `{id,billId,status,amount,receivedAmount,refundedAmount,remainingRefundAmount,eligibleLateReceipt,reconciliationRequired,pendingRefundIds,blockers}`，不返回渠道号、原始完成快照、合同正文或核实证据。

仅取消完成快照已记录、当时 CLOSED/FAILED 且实际零收款的原请求，之后获得可信 SUCCEEDED，身份/账单/客户/金额不变、版本递增且更新时间不早于取消完成，才允许专用恢复。渠道成功时间可能早于完成时间（延迟通知），不能据此丢弃真实款。完成之后新造的付款不纳入该入口。

新请求复核全部阶段资金及来源 hash，无其他未决退款；仅允许为这笔真实款保留必要 reconciliation 标记。已全退的历史付款或仍关闭的零实收请求不妨碍其他合格晚款。执行仍经 `/admin/refunds/:refundId/approve` 的实际员工独立复核及真实渠道结果核对，再用既有 payment reconciliations 独立确认 REFUNDED。重复成功回放不重复退款，不改 Case、Change、Stage 或完成 hash/snapshot。

常见错误包括 FORBIDDEN、STAFF_SESSION_CHANGED、SESSION_EXPIRED、VERSION_CONFLICT、PREVIEW_CHANGED、IDEMPOTENCY_CONFLICT，以及 RENEWAL_CANCELLATION_* 的 SOURCE、AGREEMENT_REQUIRED/INVALID、SIGNATURE_REQUIRED/CONFLICT、FUNDS_UNRESOLVED、REFUND_SOURCE/PENDING/UNRESOLVED。来源读取异常必须报错，不能补零或当作可完成。
