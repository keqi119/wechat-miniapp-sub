# 内部事故、维修、保养与费用

本地已实现的 010 模型与专用 API。`ServiceRequest` 仍是独立客户服务记录；内部工单不会自动更新客户服务状态、权益、账单或渠道支付。主接口见 [api-contract](api-contract.md)。所有写入带当前 `revision`、`idempotencyKey`，先验证当前人员角色及会话版本，再处理旧成功键；同键异体拒绝。

## 运营与车辆保养

`asset-work-orders.read` 允许 ADMIN/OPERATIONS/FINANCE；写入仅 ADMIN/OPERATIONS。`vehicle-maintenance` 读写仅 ADMIN/OPERATIONS。运营 DTO 不含财务费用、成本、付款、保险到账金额或对应凭据；财务事件仅保留动作、人员、时间及版本。

- `GET /admin/asset-work-orders`：分页、keyword、vehicleId、kind、status、assigneeId、priority。`GET /assignee-options` 仅返回当前有效管理员/运营的 id/name/role；分页完整可选。
- `GET /:id`：当前运营事实、车辆版本、专用附件、历史事件、独立限制和维护摘要。
- `POST /`：`revision:0,vehicleId,vehicleRevision,kind,priority,title,description,occurredAt,sourceServiceRequestId:null|id,relatedWorkOrderId:null|id,costConfirmationRequired,noCostReason:null|string,accident:null|{accidentAt,location,description}`。事故类型为 `ACCIDENT_REPAIR`，必须提供事故事实；其他类型为 `REPAIR/MAINTENANCE`。无成本须明确原因。
- `PATCH /:id`：仅 PENDING，可改标题、说明、优先级及成本确认要求；已有任何财务来源不可改成本要求。
- `POST /:id/assign`：reason、assigneeId、providerName、contact、scheduledAt（可空）。`start/wait/resume/return-for-work/cancel`：reason。
- `submit-acceptance`：solution、fileIds；保养另传 `maintenance:{completedOn,mileageKm,nextDueDate:null|date,nextDueMileageKm:null|int,scheduleRevision,reason}`。
- `accept`：reason、fileIds；形成真实 `ACCEPT` 事件及摘要。有成本转 `PENDING_COST_CONFIRMATION`，明确无成本才关闭。
- `notes`：追加 note，终态仍可追加；`claim`：reason、fileIds、insurerName、claimNumber、claimStatus。人工理赔结论不代表到账。
- `restrictions`：reason、fileIds、vehicleRevision、scopes（`ALLOCATION/DELIVERY`）；`restrictions/:restrictionId/release`：reason、fileIds、vehicleRevision、restrictionRevision。均独立递增车辆版本。关闭工单不自动解除限制，关闭后仍可明确解除原限制。限制阻止新占车/交付，安全还车继续允许。
- `GET/PATCH /admin/vehicle-maintenance/:vehicleId`：GET 返回可信实际里程及已验收完成事实；PATCH 传 revision、vehicleRevision、nextDueDate、nextDueMileageKm、reason，只维护下次阈值。完成事实来自实际保养验收，不改写客户里程或权益。

发生时间须明确时区，业务自然日采用上海日界。客户服务来源按事件时点核验真实 VehicleAssignment 区间 `[startAt,endAt)` 及完成交接；换车来源另验证同一 OrderChange、双侧交接、实际指针及版本。不能从订单初始车辆推断当前归属，缺证据则拒绝关联。新增工单页面已接入真实来源分页、详情核对和明确确认；变更车辆或发生时间会清除选择。

`GET /admin/asset-work-orders/service-source-options` 与 `/:sourceId` 接收 vehicleId、带时区 eventAt；列表另接 keyword/page/pageSize。当前 ADMIN/OPERATIONS 同时具备本模块与 services 读取权限才可访问，响应仅含服务类型/状态/说明/订单编号及真实分配区间，不返回姓名、手机号、客户编号或文件。选定来源的新建请求须补 `sourceServiceRequestRevision` 和 `sourceServiceRequestHash`，创建事务重查真实来源和摘要；无来源保持独立工单。旧成功 key 先查当次权限后可按原请求回放；首次请求缺来源凭据或同 key 改内容拒绝。关联不改变客户服务状态或权益。

## 财务费用来源与关单

`asset-work-order-costs`、`asset-work-order-cost-lines` 仅 ADMIN/FINANCE 读写。历史来源验证原真实 ACCEPT 及原文件摘要；新的冻结、首次入账、计划重开必须同时匹配当前真实验收。重新验收后，旧未入账计划须明确作废，再创建有替代关系的新来源。

- `GET /admin/asset-work-order-costs`：分页与可选 vehicleId/status，返回工单财务头。
- `GET /:id`：`{workOrder,lines,plans,entries,payments,recoveries,totals}`。合计分别为 plannedAmount、confirmedAmount、reversalAmount、netCostAmount、manualPaidAmount、manualRecoveryAmount，不把保险回收自动抵销成本。
- `POST /:id/lines`：revision:0、workOrderRevision、amount（正整数分）、category、occurredOn、supplierName、referenceNo、reason、replacesCostId（可空）。保养仅 MAINTENANCE，维修/事故允许 REPAIR/TOWING。
- `GET /admin/asset-work-order-cost-lines`：分页及 vehicleId/workOrderId/status/category；`GET /:id` 加该费用的专用附件。
- `PATCH /:id`：DRAFT 才可更正 amount/occurredOn/supplierName/referenceNo/reason，不改类别和归属。
- `POST /:id/preview`，严格空对象：只读返回 lineId/lineRevision/workOrderId/workOrderRevision/amount/costPeriod/periodStart/periodEnd/sourceSnapshot/sourceHash/previewHash。
- `POST /:id/prepare`：revision、workOrderRevision、previewHash；返回 `{line,plan}`，冻结所有费用依据，生成唯一 WORK_ORDER 计划。发生日期不得晚于上海今天；每笔金额不超过 2147483647 分。
- `POST /admin/asset-work-order-costs/:id/close`：工单 revision、reason；须存在有效成本，且无未决草稿费用或待确认计划，追加 FINANCE_CLOSE。
- `POST /:id/reopen-cost-review`：工单 revision、reason、entryId、entryRevision；明确重开 CLOSED 工单进行财务纠错，保留原物理验收。
- `POST /:id/recoveries`：revision:0、workOrderRevision、costEntryId、entryRevision、amount、receivedOn、referenceNo、reason、fileIds。只登记有凭据的保险实际到账，更新成本版本，返回独立 INSURANCE_RECEIPT。
- `POST /:id/recoveries/:recordId/void`：工单 revision、recordRevision、entryRevision、reason。保留原记录及明确撤销；不调用退款。

## 共用台账与文件

确认、锁定、冲正及人工付款继续使用原 `asset-cost-plans/asset-costs` 接口。WORK_ORDER 允许同车同月多笔真实费用，每来源唯一计划及原 COST。更正须原计划未入账已 VOIDED，或原 COST 已完整同源冲正，并且最多一个明确替代来源。BAAS 期间互斥及折旧累计预算保持。

维修、保养、拖车可按原成本整笔登记人工付款，折旧不可。存在有效人工付款或保险回收时拒绝冲正；已关闭工单最后一笔有效成本须先明确财务重开。旧金额和证据不可 PATCH 覆盖。人工登记不代表渠道交易，也不生成客户 Bill/Payment。

`POST/GET /admin/asset-work-orders/:id/files` 及 `GET /files/:fileId` 访问运营凭据；费用同样使用 `/admin/asset-work-order-cost-lines/:id/files`。仅接受本父对象的私有文件，上传校验 revision/key；冻结费用不再追加凭据。付款凭据通过成本自己的 files 路由维护，原费用凭据保留在费用来源。通用文件接口及客户端不能旁路读取。
