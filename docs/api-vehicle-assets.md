# 车辆资产与内部成本 API

2026-10-31，本地实现/验证，未部署。金额均整数分，日期YYYY-MM-DD，账期YYYY-MM；列表page/pageSize≤100。当前工作人员权限、revision、稳定idempotencyKey及事务审计适用于所有写命令。内部成本不写客户Bill/Payment，不调用资金渠道。

## 资料与BAAS

- GET/PATCH `/admin/vehicle-assets/:vehicleId`。GET未建档返回registered:false/revision:0；财务不返回notes。PATCH为`{revision,vehicleRevision,idempotencyKey,batteryOwnership?,firstRegistrationDate?,notes?}`，首次保存revision变1。电池UNKNOWN/OWNED/BAAS，存在ACTIVE BAAS时不能改为非BAAS。首次登记日不替代车型年款或车辆年份。
- GET/POST `/admin/baas-contracts`，GET/PATCH `/:id`。列表可筛vehicleId/status/keyword。创建含vehicleId/vehicleRevision/assetRevision/revision:0/key及草稿；PATCH只改DRAFT条款，不能改车或直接改status。
- 草稿字段：provider、contractNumber、supplierContractNumber、batteryPackage、batterySerialNumber、effectiveFrom/effectiveTo、billingCycle（MONTHLY/QUARTERLY/YEARLY）、rentalAmount>0、paymentDayOfMonth（1–31）、graceDays（0–365）、invoiceRequired、taxIncluded:boolean|null、currency:CNY、notes、previousContractId:null|id。供应商合同号/序列号/备注可空。
- POST `/:id/activate|suspend|resume|terminate|archive`接`{revision,idempotencyKey,reason}`。启用/恢复须BAAS电池、本合同专用附件及同车无其他ACTIVE；启用后计价冻结。DRAFT或TERMINATED可归档。终止不自动作废计划、退款或冲正。
- GET `/:id/cost-preview?fromPeriod=&toPeriod=`最多120期，返回`contractId/sourceId/revision/assetRevision/algorithmVersion/request/rows/totalAmount/createCount/existingCount/totalCreatedAmount/warningIds/previewHash`。行含costPeriod、periodStart/End、dueDate、amount、warningIds、existingPlan。自然周期按原周期租金整笔计算，付款日月末夹取；超出合同日期明确警示，不擅自按日折算。
- POST `/:id/cost-plans`接原fromPeriod/toPeriod、revision/key/previewHash/acknowledgedWarningIds。重算当前状态，409须重新预览；首次生成冻结firstCostPeriod，之后周期相位不能平移。已有同期间记录包括VOIDED均跳过。同车同类有效期不能重复计费。SUSPENDED可显式补期，TERMINATED/ARCHIVED不可新生成；历史真实启用来源的旧计划仍可核对确认。

## 折旧策略

- GET/POST `/admin/depreciation-policies`，GET/PATCH `/:id`，仅ADMIN/FINANCE。创建含vehicleId/vehicleRevision/revision:0/key、method（STRAIGHT_LINE/MANUAL/NONE）、basisAmount/basisSource/basisEvidence/residualAmount/startDate/usefulLifeMonths、currency:CNY、notes、previousPolicyId。直线法月数1–120，其他方法为null；残值不高于基数。修改只限DRAFT。
- POST `/:id/activate`接revision/key/reason；有previousPolicyId须同时给previousRevision，当前ACTIVE必须就是该前策略。同车单ACTIVE，附件和真实依据完整；旧有效计划/未冲正成本与承接区间冲突时拒绝，不能隐式取消旧计划。前策略转SUPERSEDED，历史不改。POST `/:id/archive`只改变策略状态。
- POST `/:id/cost-preview`是无写入的试算，MANUAL body含manualPeriods:[{costPeriod,amount,reason}]，其他方法body:{}。POST `/:id/cost-plans`另加revision/key/previewHash/acknowledgedWarningIds:[]。返回policyId及共用预览/生成结构；预览增加budget:{depreciableAmount,committedAmount,remainingAmount}，摘要绑定同策略全部计划及确认/冲正事实。
- 直线法每期floor((基数-残值)/月数)，最后一期补尾差；首个不足自然月仍为完整一期金额。MANUAL按明确月份/金额/依据，最多120期，跨批有效计划与未冲正确认合计不得超过可折旧额；生成、重开、确认都校验。NONE明确不计提，不产生计划或成本分录。

## 计划与财务台账

- GET `/admin/asset-cost-plans`及`/:id`；支持vehicleId/sourceKind/costPeriod/status。运营仅BAAS范围，SQL列表和总数同范围。POST `/:id/void`接revision/key/reason，只可作废从未确认的SCHEDULED；POST `/:id/reopen`另需sourceRevision/previewHash，从当前有效来源重新核验，不复活已确认记录。BAAS维护由ADMIN/OPERATIONS，折旧维护由ADMIN/FINANCE。
- GET `/:id/reopen-preview`为作废计划提供专用只读重开预览，服务端使用BAAS原单期或MANUAL冻结的原始批次与理由；返回`planId/planRevision/sourceRevision/sourceKind/costPeriod/amount/previewHash/warningIds/rows`。确认仍走原reopen命令，以planRevision作为revision；浏览器不能从作废理由臆造原手工折旧请求。来源状态、跨批预算和重叠期间与正式重开使用相同守卫，预览不增版本、不写审计。
- POST `/admin/asset-costs/confirm`接`{plans:[{id,revision}],idempotencyKey}`，仅ADMIN/FINANCE，1–120条不重复。全批校验真实来源、金额、期间及累计预算，一次事务生成唯一COST并标CONFIRMED；任一冲突全批回滚。
- GET `/admin/asset-costs`及`/:id`；支持vehicleId/category/effect/costPeriod，列表totals分别costAmount/reversalAmount/netAmount，不能与计划额或人工付款额相加。详情含source、payments、reversal及本成本专用files。
- POST `/:id/lock|reverse`接revision/key/reason；锁定不可解锁，冲正新增REVERSAL保留原分录。已锁定、已冲正或有有效人工付款登记时不能直接冲正。
- POST `/:id/manual-payment`接revision/key/reason/paidAt/referenceNo/fileIds，对有效 BAAS_RENT、REPAIR、MAINTENANCE、TOWING 原 COST 整笔登记，金额复制原成本；折旧不提供人工付款登记。日期不得晚于上海今天，证据须本成本专用文件。POST `/:id/manual-payments/:recordId/void`另带recordRevision，留原记录及撤销原因；不是退款。锁定成本可基于既有证据登记付款事实，但不能再加附件或改变成本金额。

WORK_ORDER 来源通过真实 workOrderCostId 关联冻结费用；同车同月可有多个来源，每来源仍仅一个计划和原成本。新确认、重开、替代关系及保险到账的精确守卫见[内部工单契约](api-internal-work-orders.md)，不使用 BAAS 月期互斥或折旧预算代替工单来源规则。

## 牌照备案与绑定

仅ADMIN/OPERATIONS读写。归属引用VehicleOwner备案，不授予合作商访问权、不变更订单车属或收益。所有写入带revision/idempotencyKey，当前工作人员权限先于命令重放校验。

- GET/POST `/admin/license-plates`，GET/PATCH `/:id`；列表支持keyword/status/page/pageSize。创建为revision:0、plateNumber、plateType、可选region/notes；号码规范化NFKC/大写/去空白用于唯一校验，最多32字，拒绝控制字符。PATCH只改plateType/region/notes，已登记号码不可换身份。详情含最小车辆/归属人身份、当前期间、历史期间和本牌照专用文件元数据。
- GET `/admin/license-plates/legacy-candidates`只读列出旧车辆牌号、规范号码、是否可规范化及重复车辆ID；不推断归属、不创建历史。
- GET `/admin/license-plates/owner-options?keyword=&page=&pageSize=`按名称或ID搜索未停用归属主体，完整分页，返回`{items,total,page,pageSize}`。GET `/owner-options/:ownerId`回读最新版本与当前状态（含已停用状态），两者只给`id/name/subjectType/status/revision`；不读取合作商财务、联系人或签署档案。
- POST `/:id/ownership`：ownerId/ownerRevision、currentOwnershipPeriodId/currentOwnershipRevision（无当前则均null）、reason/fileIds。结束旧期间并从实际操作时刻开始新期间，不回填历史日期。
- POST `/:id/bind`：vehicleId/vehicleRevision、currentBindingId/currentBindingRevision/oldVehicleId/oldVehicleRevision（无当前则四项均null）、reason/fileIds。移动本牌照须明确旧车及版本；目标车已有其它有效牌照需先解绑。未核验的重复旧牌号也拒绝抢占。
- POST `/:id/unbind`：bindingId/bindingRevision/vehicleRevision/reason。仅结束当前期间并清空匹配的Vehicle.plateNumber，保留VIN、订单和冻结合同资料。
- POST `/:id/clear-legacy`：vehicleId/vehicleRevision、未经trim的原始plateNumber、reason/fileIds。只清理与本牌照规范号码匹配且无有效绑定的旧车辆文本；记录真实前后值和凭据，不伪造已核验期间。已有绑定必须用正式解绑。用于显式处理旧数据中的重复牌号。
- POST `/:id/archive`：reason。必须无有效车辆绑定，当前归属期间同时结束；不删除历史或附件。
- 上述fileIds为本牌照专用文件，1–20个且不重复。上传/列表/下载通过`/:id/files`及`/:id/files/:fileId`；通用文件和对客入口不可读取。普通车辆创建不接受非空plateNumber，普通编辑仅接受同值；换牌必须走牌照办理入口。原成功编辑命令同键回放保留原结果，不重新校验成一次新编辑。

`key`在上述简写中均为`idempotencyKey`。专用文件契约见主API契约；对应页面的独立进度见施工证据，不把数据库结构存在等同于完整页面已上线。

## 残值基础增量

资产资料GET/PATCH新增可空`batteryCapacityKwh`。输入必须十进制字符串，最多三位小数、0至99999.999，返回去前导/尾随零的规范字符串；省略保留、显式null清除，空字符串不代表清除。当前资产/车辆版本、权限、幂等及审计沿用原入口，不改变车型、租金、客户账单或折旧。

样本、曲线、预测与独立估值七个模型已建立；市场样本和估值凭据使用上述六类专用文件边界。样本/导入/曲线业务接口另包施工，数据库存在不表示模块已经交付。

## 库存资料初始化增量（2026-10-31）

以下为本次新增契约，覆盖上文对应的必填限制；发布状态以本次交付证据为准。

- 资产GET/PATCH新增可空`engineNumber`（1–200字）、`bodyColor`（1–100字）、`initialMileageKm`（非负Int）、`purchaseAmount`（非负整数分）、`purchaserName`（1–200字）、`purchaseDate`及`nextInspectionDate`（严格日期）。省略保留、null清除；文本trim且拒绝NUL。登记所有人沿用`registeredOwnerName`。FINANCE不返回登记所有人、购车人或notes。初始里程不自动改动车辆当前`mileageKm`，采购金额不自动生成折旧或成本。
- BaaS增加选填`supplierOrderNumber`（外部订单号，最大500字）、`batteryBrand`（200字）、`lesseeName`（200字）、`lesseeCreditCode`（18位大写字母数字）、`lessorCollectionAccountInfo`（2000字）。文本空白归一为null；省略PATCH字段保留原值。收款账户按字符串处理，仅已授权后台详情/更新返回，列表和车辆摘要不返回。
- 复用`provider`表示电池出租方，`batteryPackage`表示电池规格。车辆所有人、VIN、车牌由关联车辆投影读取，不接受合同字段重复修改；FINANCE详情不返回登记所有人。创建可省略内部`contractNumber`，首次执行事务生成`BAAS-<UUID>`，同键重放返回相同编号。外部订单号不必填。
- 从未启用的DRAFT允许`provider`、`batteryPackage`、`effectiveFrom`、`billingCycle`、`rentalAmount`、`paymentDayOfMonth`为空；非空值继续验证原域。`missingFields`报告这六项的缺失项。`effectiveTo=null`表示长期，外部订单号和结束日期不属于缺失必填项。
- ACTIVE/SUSPENDED/TERMINATED或任何曾启用记录须保有六项完整条款；启用、恢复及成本来源加载均重核。DRAFT可归档保留未知值，不制造合同期限或租金。长期合同成本预览/生成仍须明确有限账期，最多120期，不能因空结束日期无限生成。
- 新元数据不进入原16项计费条款摘要；原有限期合同的termsHash及无新字段的旧请求摘要保持兼容。全部写命令保留当前岗位校验、版本冲突、事务幂等与审计。本次Excel初始化不自动启用合同、生成成本或登记历史扣款。
- BaaS创建审计包含五项元数据规范摘要`metadataHash`；更新记录`previousMetadataHash`及`metadataHash`，缺省统一null。账户原文不进入审计，摘要独立于计费termsHash。
- POST `/admin/vehicle-assets/:vehicleId/mileage-correction`为独立库存读数更正，仅当前ADMIN。输入`{vehicleRevision,previousMileageKm,mileageKm,expectedReservedOrderId,expectedOrderStatus,reason,sourceReference:{fileSha256,sheetName,cellReference},idempotencyKey}`。两个预期订单字段须同为空或明确AWAITING_PAYMENT；来源为64位小写SHA、工作表名与A1单元格。严格非负Int且不允许读数回退。命令先锁预期订单再锁车辆，原值/版本/占用/hold作CAS，只更正Vehicle.mileageKm并增revision，记录前后值及来源，不改订单确认里程、快照或财务记录。仅无占用DRAFT/PUBLISHED/UNPUBLISHED或明确绑定且未交付的RESERVED+AWAITING_PAYMENT可办理；有效hold、任何已有分配/交付证据/已审核里程及其他有效订单均拒绝，亦不得低于关联订单的确认读数。普通车辆编辑的占用限制继续保留。
