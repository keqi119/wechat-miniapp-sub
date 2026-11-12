# 逾期账单与人工催收 API

Exports: `OverdueBillsController`, `CollectionCasesController` from `src/collections/controller.ts`. Both resources are current ADMIN/FINANCE only; overdue-bills read only. Root registers controllers and owns roles. No SMS/WeChat/email/provider send occurs.

## Inputs

- GET `/admin/overdue-bills`: page(1 default), pageSize(20 default, max100), optional orderId/customerId/keyword/level D1..D5. Stable Bill.id ascending candidate scan; filtering follows trusted cash calculation, keeping blocked candidates. Returns `{items,total,page,pageSize,asOfDate}`. Items include safe BillFact plus order/customer below.
- POST `/admin/collection-cases/preview`: strict `{orderId}`. Read-only, no audit/command/version writes.
- POST `/admin/collection-cases`: `{revision:0,idempotencyKey,orderId,previewHash,reason}`. Requires positive confirmed overdue and no ACTIVE case. Case starts revision1 and CREATE0→1.
- GET `/admin/collection-cases`: page/pageSize plus optional orderId/customerId/keyword/status ACTIVE|CLOSED. Returns `{items,total,page,pageSize}`. List items are the detail header, compact recorded/current summaries, sourceChanged and previewHash; no link/action/raw-cash payload.
- GET `/:id`: full detail below.
- POST `/:id/refresh`: `{revision,idempotencyKey,previewHash,reason}`; adds newly confirmed overdue bill links, never overwrites initial link evidence.
- POST `/:id/actions`: `{revision,idempotencyKey,method,actionType,result,content,promiseDate,promiseAmount,nextFollowUpDate}`. All nullable fields must explicitly be null or supplied value. method PHONE/SMS/WECHAT/EMAIL/OFFLINE/OTHER; actionType REMINDER/FOLLOW_UP/PROMISE_TO_PAY/CUSTOMER_DISPUTE/ESCALATION; result SUCCESS/NO_ANSWER/CUSTOMER_PROMISED/CUSTOMER_REFUSED/DISPUTED/INVALID_CONTACT/OTHER. content1..4000; persisted reason fixed 人工联系记录, content never truncated. Promise fields paired, positive integer fen≤current confirmed overdue; PROMISE_TO_PAY or CUSTOMER_PROMISED requires promise. Promise/next followup dates not before Shanghai today. Records an already performed manual action; never changes Bill/Payment/Refund.
- POST `/:id/close`: `{revision,idempotencyKey,previewHash,closeReason}`. Requires all linked bills truly settled or VOID, no current new overdue and no unresolved cash blocker. Closed history cannot reopen or accept actions; later debt uses new case.

Every successful mutation returns full detail. Keep exact body/key on unknown outcomes; after success but read failure retry GET only. Keys replay after current staff auth but before current financial-state validation.

## Projections

`order` = `{id,status}`; `customer` = `{id,name,mobile}` only.

Preview = `{order,customer,activeCase:{id,revision}|null,current,previewHash}`.

Detail = `{id,orderId,customerId,revision,status,createdBy,updatedBy,createdAt,updatedAt,closedAt,closedBy,closeReason,order,customer,recorded,current,sourceChanged,previewHash,links,actions}`.

`current` / detail `recorded` = `{asOfDate,totalOverdueAmount,maxOverdueDays,level,overdueBillIds,blockedBillIds,linkedBillIds,canClose,sourceHash,bills}`. Recorded is last explicit creation/refresh/close frozen source; CONTACT advances revision/actions but does not silently refresh recorded debt. Current is a readonly calculation, does not update rows. List compact recorded has day/amount/maxDays/level/hash; compact current adds blocked/overdue/canClose but no bills.

Safe BillFact = `{billId,orderId,customerId,type,status,amount,paidAmount,dueDate,overdueDays,level,outstandingAmount,confirmedOverdueAmount,settled,blockers,sourceHash}`. Invalid/unconfirmed amounts are null, never treated as zero. Only confirmed positive overdue contributes totals/stage. No providerTransactionId/providerRefundId, clientParameters/requestSnapshot, identity/profile/sourceChannel or raw sourceSnapshot in any public list/detail/preview.

Link = `{id,billId,initialDueDate,initialAmount,initialOverdueAmount,initialAsOfDate,sourceHash,linkedBy,linkedAt}`.
Action = `{id,sequence,beforeRevision,afterRevision,kind,reason,sourceHash,source:{asOfDate,totalOverdueAmount,maxOverdueDays,level,overdueBillIds,blockedBillIds,sourceHash},actorId,createdAt,method,actionType,result,content,promiseDate,promiseAmount,nextFollowUpDate}`. Kind CREATE/REFRESH/CONTACT/CLOSE. Noncontact fields null. Action.source intentionally omits canClose and linkedBillIds: the action freezes financial facts, not the historical case-linked bill set. Only current/recorded summaries with their actual case context expose close eligibility.

## Expected conflicts / blockers

- PREVIEW_CHANGED: retain edits, obtain fresh preview and require recheck; never auto-resubmit changed money.
- REVISION_CONFLICT: refresh current case; preserve operator input for explicit decision.
- COLLECTION_ACTIVE_EXISTS: open existing ACTIVE case; never manufacture a second case.
- COLLECTION_NO_CONFIRMED_OVERDUE: no positive trusted overdue; blocked amounts require reconciliation rather than fabricated debt.
- COLLECTION_NOT_SETTLED: linked unpaid/deferred bill, new overdue, or unresolved cash prevents close.
- COLLECTION_CASE_STATE: CLOSED cannot change; retain its history.
- COLLECTION_PROMISE_AMOUNT / COLLECTION_PROMISE_DATE / COLLECTION_FOLLOWUP_DATE: correct explicit manual facts.
- COLLECTION_HISTORY_INVALID / COLLECTION_OWNERSHIP_MISMATCH: stop handling and surface discrepancy.
- IDEMPOTENCY_CONFLICT: same key has another body; never silently overwrite original command.
- STAFF_SESSION_CHANGED / FORBIDDEN: clear private state on role/session change.

Blockers are exported `CollectionBlocker` in facts.ts: MONEY_INVALID, FACTS_INCOMPLETE, BILL_STATE_UNKNOWN, PAYMENT_STATE_UNKNOWN, REFUND_STATE_UNKNOWN, PAYMENT_IN_PROGRESS, REFUND_IN_PROGRESS, OWNERSHIP_MISMATCH, RECEIPT_UNVERIFIED, RECONCILIATION_REQUIRED, RECEIPT_MISMATCH, DUPLICATE_FACT, PAYMENT_REVISION_INVALID.

All money in integer fen; dates YYYY-MM-DD; timestamps ISO JSON. PAGE offset bounded1,000,000. Unknown DTO fields/NUL rejected. New commands lock Order→Case→Bill and issue UPDATE Order SET revision=revision after the Order lock. The real BillingService.settle late-receipt race proved the pre-lock SERIALIZABLE snapshot otherwise closes incorrectly. This same-value write establishes a serialization dependency without changing business revision or updatedAt. Successful cached keys skip this write. Guarded HTTP DB 2/2 preceded the final read-only Action.source omission; that projection is separately red→green and included in the final 28 pure tests. No DB rerun is claimed after the projection-only change.

