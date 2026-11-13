# 独立平台 API 契约：客户资料、独立实名与 v2.3 合作

## 2026-11-10 正式电子签切换

本轮 ELECTRONIC 新订单、纸质写入口关闭、03—06 客户办理与退款人工复核投影见[正式切换接口增补](api-electronic-cutover-20261110.md)。发布状态以实际部署及微信版本证据为准，代码接入不等于生产门禁已启用。

## 2026-10-31 保障要求管理退役

用户确认取消独立“保障要求”管理以及流程配置依赖。导航、保单表单、到期待办和订单跳转均取消该入口；旧直链只显示停用说明，不读取配置。原管理接口先校验会话和权限，再返回 `410 COVERAGE_REQUIREMENTS_RETIRED`，不再生成补核任务。历史表、版本、已审记录及已冻结订单证据保留。

新保单草稿不要求 `requirementVersionIds`；审核使用逐车 `{vehicleId,fileId,confirmed:true,note}`，核对真实原件、车辆和期限。历史审核请求格式保留幂等兼容，但不读取或依赖当前要求配置。录入/修改/上传/提交者不能自审，实际附件与本保单及被保车辆的绑定、revision、幂等和审计保持。

交付、换车和续期统一按当前已批准且生效的保单版本检查；缺保单、未审核、未开始、过期、退保、移出被保范围或缺原件核证仍阻断。有效重叠保单可以提供保障。`coverageAt` 保留返回字段，当前 `requirementIds:[]`，不读取保障要求表；真实保单到期提醒保留。订单和库存检查不再引导补配已取消的规则。

## 2026-10-31 后台反馈：车辆台账、筛选与多产品卡槽

本节记录本轮新增契约，实际发布状态以对应发布证据为准。用户确认：车辆所有人按机动车登记证填写，作为产品筛选“车辆登记人”；合作商单独展示。小程序生产发布暂停。

- `GET /admin/vehicles?view=product-selection`：ADMIN/OPERATIONS 且具有车辆读取权限；`page` 1–10000、`pageSize` 1–100。可组合 `registeredOwnerName/brand/model/plateNumber/vin` 包含匹配、`modelDefinitionId/modelYear/cooperationOwnerId` 精确匹配、`ageMonthsMin/ageMonthsMax/mileageKmMin/mileageKmMax` 闭区间及既有 keyword/status。拒绝重复、未知或非法参数，列表与 total 共用完整筛选条件。
- 选择投影包含车辆标识、revision、名称、品牌/车型、真实车型年款、上牌年份、首次登记日期、车龄整月、里程、车牌/VIN、状态、城市、`registeredOwnerName` 与 `cooperationOwner`；返回 `ageAsOf` 上海日期。缺首次登记日期不估计车龄，也不匹配车龄筛选；登记人不回填合作商、牌照主体或建档员工。
- 默认车辆列表与详情仅对 ADMIN/OPERATIONS 追加上述台账事实；FINANCE/SUPPORT 等岗位保留原车辆读投影，不能用高级筛选读取新增姓名。`cooperationOwner` 为当前有效合作摘要 `{id,name,source}` 或 null，不代表车辆法定所有人。
- 2026-11-03补充：相同后台权限下，列表、详情及产品选择投影增加 `cooperationRegistration: null | {status:'PENDING_AGREEMENT'|'CONFLICT',owners:{id,name}[]}`。仅取未暂停合作商的当前DRAFT协议最新DRAFT版本车辆集合，按主体去重，并排除与当前有效合作商相同的候选。无有效关系且唯一候选为待补协议；多个主体或与当前有效主体不同为冲突。台账显示登记名称和“协议待补”，冲突明确显示候选，不任取第一个。此字段仅为后台资料关联，不参与有效协议、订单、分润或合作商外部访问；`cooperationOwner`及`cooperationOwnerId`有效关系筛选含义不变。来源匹配规则以[本轮方案](superpowers/specs/2026-11-03-vehicle-partner-source-design.md)为准。
- `GET/PATCH /admin/vehicle-assets/:vehicleId` 增 `registeredOwnerName`（1–200字 trim 文本或 null；省略保留、null 清除），沿用 `vehicleRevision/revision/idempotencyKey`、审计和授权。FINANCE 读取不返回登记人姓名。
- `GET /admin/goods` 增可选 `vehicleId` 精确筛选，total 同范围；空、重复或非法标识不能回退所有车辆。每台车可有多条不同已发布产品版本组合，沿用每条独立 DRAFT/PUBLISHED/WITHDRAWN、revision、发布/下架及可见性命令。
- 兼容套餐不再作为后台业务模块呈现；既有 `subscriptionPlanId` 只用于兼容客户端与历史引用。申请仍核对选中的可售商品并冻结价格/权益，同物理车辆仍只有一个有效占用，不删除历史套餐或改写历史订单。
- 2026-11-03车辆上架提示修正：商品卡槽发布与车辆上架分别管理；公开车辆目录仍只返回 `Vehicle.status=PUBLISHED`。车辆上架缺有效套餐或缺车况披露均保留 `409 PUBLISH_REQUIREMENTS`，分别提示补齐已发布的本车产品卡槽或真实车况披露。后台商品 `visible` 仅表示展示设置，不能单独推导 App 实际可见；缺车况时引导现有车辆编辑入口。业务条件409保留服务端原因，只有 `REVISION_CONFLICT/VERSION_CONFLICT` 显示记录变化提示。合作资料不足的已上架车辆仍可浏览，并保持 `available:false`。
- 合作商详情“当前合作车辆”读取本合作商有效 `vehicles` 投影；`vehicleAssignments` 是跨合作商重新分配校验资料，不得作为关联车辆展示或数量来源。


**2026-10-31 续期接入状态：OrderRenewalsController/Service 已注册实际 createApp。专用取消、双方期前互认、纸档和关联全退/迟到款入口已实现，真实 App + 隔离库 HTTP 链已验证，尚未部署。供应商测试均为本地合成 transport；未触发真实交易或签章。**

## 2026-10-31 同车续期与分阶段支付增量（已注册，未发布）

本节按当前 `order-renewals/{controller,types,context,workspace,service,finance,activation,payment}.ts`、`billing/stage-payments.ts` 和合作商订单只读投影记录。本节更新续期相关实施进度；下文旧章节的接口与历史记录不重写。基地址仍为 `/api`；金额整数分，业务日期按上海时区。续期服务范围为 `[startDate,endDate)`，`newEndDate` 为最后用车日（含），不要混用。原订单追加服务段，不新建订单、不造交付/归还事实。

### 当前岗位与只读边界

固定五岗位每人一岗；以下权限还须通过当前员工有效状态、会话 `authVersion`、资源权限及业务状态校验，ADMIN 也不绕过独立报价复核。

| 动作 | ADMIN | OPERATIONS | FINANCE | SUPPORT / FIELD |
| --- | --- | --- | --- | --- |
| 续期列表、详情、订单 context / goods、报价 preview | 允许 | 允许 | 允许 | 拒绝 |
| create / quotes / publish / 未确认草案 cancel | 允许 | 允许 | 拒绝 | 拒绝 |
| review / finance-preview / finance/prepare / schedule-preview / schedule | 允许 | 拒绝 | 允许 | 拒绝 |
| activation-preview / activate | 允许 | 允许 | 拒绝 | 拒绝 |

客户 confirm/reject 仅使用真实归属客户会话，任何工作人员岗位都不能代客户确认。当前控制器默认 GET 成功为200、POST成功为201（含只读POST preview）；业务返回体以下述 DTO 为准。

后台 Cookie 会话和修改请求的 Origin、`X-CSRF-Token` 规则不变。仅精确 `POST /admin/orders/:id/renewals/preview` 按 `order-changes.read` 鉴权；仍先校验当前会话、Origin 和 CSRF，其相邻创建/操作路径不因此降为只读权限。`/admin/order-renewals` 映射既有 `order-changes` 资源，再由服务逐动作区分岗位。`activation-preview` 无业务写入，但要求运营办理权限。客户使用真实 Bearer 会话，其他客户的详情/命令返回 404。所有新续期 GET 与 preview 不建 INITIAL、不激活、不记支付或增加业务版本；预览可在短事务中读取并锁定来源。

### 订单上下文、商品与报价预览

| Method | Path | 输入/输出 |
| --- | --- | --- |
| GET | `/admin/orders/:id/renewal-context?changeId=` | 新建省略 `changeId`；重报价传本单真实续期 ID。可办理时返回 `orderId,changeId?,orderRevision,accountRevision,priorTermsHash,vehicle:{id,title,vin,plateNumber},assignmentId,currentStage,depositAmount,eligible:true,canCreate,blockers:[]`；来源业务未就绪时返回 `{orderId,eligible:false,blockers}`，不能补默认可办理值。 |
| GET | `/admin/orders/:id/renewal-goods?keyword=&page=&pageSize=&changeId=` | 当前实际在用本车的明确已发布、可见商品及 PUBLISHED v2 产品版本。`keyword` 按产品名包含筛选，最长100字；page默认1、1–1000000，pageSize默认20、1–100。返回 `{items,total,page,pageSize}`，count与列表同范围。 |
| POST | `/admin/orders/:id/renewals/preview?changeId=` | 严格输入下述 `RenewalPreviewInput`，返回下述白名单预览；纯读取，不保存候选或自动建单。 |

`changeId` 必须为单个有效 ID、属于 URL 中订单；重复参数形成数组、空 ID 或串单不能当作“未提供”。context/goods 只允许恢复未确认草案，或已过期且未确认的已发布报价。商品分页不按固定前100条截断选择。`currentStage` 为 `{id,candidateId,kind,startDate,endDate,months,monthlyFeeAmount,usagePricing}`；未物化 INITIAL 时 `id:null`，`candidateId` 仅表示可在真正创建时核验的候选。

商品 item 为 `{listingId,listingRevision,sourceHash,productVersionId,name,months,monthlyFeeAmount,mileagePerMonthKm,excessMileagePriceAmount,swapPolicy,unsupportedBenefits}`。`unsupportedBenefits` 是尚无阶段化规则的 COUNT 权益名称；此类商品不能完成续期预览。商品 `sourceHash` 提交时使用字段名 `listingSourceHash`，不能把两者误作不同计价来源。

`RenewalPreviewInput` 严格字段：

```text
{listingId, listingRevision, productVersionId, listingSourceHash,
 orderRevision, accountRevision, reason, expiresAt,
 settlementExplanation, cancellationTerms}
```

标识为1–500字符、无首尾空白及 NUL；revision 为0–2147483647整数；摘要为64位小写十六进制；`expiresAt` 为带时区 ISO 时间且晚于办理时刻。三段说明 trim 后1–2000字符，拒绝 NUL、未替换变量及“待补齐/待填写/另行通知”等占位文字。客户端不得额外提交月费、期数、起止日、押金、里程或赠送数覆盖产品。`cancellationTerms` 是现有报价说明字段，不能据此绕过专用取消流程或覆盖已确认的未开始续期全退政策。

预览返回：`kind:'SUBSCRIPTION_EXTENSION',startDate,endDate,months,monthlyFeeAmount,depositAmount,totalAmount,periods,usagePricing,swapPolicy,listingId,listingRevision,productVersionId,listingSourceHash,lessor,lessorHash,noticeHash,sharingNotice,coverage,previewHash`。

- `periods[]` 为 `{sequence,stageSequence,startDate,endDate,dueDate,amount}`；sequence 是全订单真实月号，stageSequence 从本段1开始，已占用或取消月号不复用。每段12–120个月，逐期金额为 Int 分，总额另校验安全整数。
- `usagePricing` 仅 `{policyVersion,baseAllowanceKm,excessPriceAmount}`；`swapPolicy` 仅 `{policyVersion,includedCount,extraFeeAmount}`。原期规则不变，新段才采用新商品规则；充换电自付。
- `lessor` 为 `{ownerId,name,subjectType,creditCode}`，`sharingNotice` 为冻结出租方共享告知，供客户阅读确认。`coverage` 为 `{currentReady,futureReady,futureBlockers}`；未来检查不是承诺整段均已投保，激活仍重核。
- 新段起点为前段真实结束边界，服务端计算末日和全局月号。须同车、同出租方、真实 ACTIVE assignment、未实际归还，且只有一份未来续期/未完成变更。原押金沿用冻结金额和真实本金，不重复收取。

### 新建、报价、复核与客户确认

以下后台写入均返回简短 receipt `{id,revision,status,quoteId:string|null}`，`id` 为续期变更 ID，**不是**详情 DTO。`idempotencyKey` 长8–120字符且无 NUL；同键同体回放原结果，同键不同体冲突。当前岗位、会话和归属在旧键回放前仍有效校验。

| Method | Path | 严格输入与结果 |
| --- | --- | --- |
| POST | `/admin/orders/:id/renewals` | `RenewalPreviewInput + {previewHash,idempotencyKey}`；建立 DRAFT，必要时在写事务中建立真实 INITIAL。此步不自动报价；orderRevision会变化，继续报价前重读 context 并预览。 |
| POST | `/admin/order-renewals/:id/quotes` | `RenewalPreviewInput + {previewHash,revision,idempotencyKey}`；新不可变报价，变更进入 REVIEW_PENDING；只允许未确认可重报状态，旧报价 SUPERSEDED。 |
| POST | `/admin/order-renewals/:id/review` | `{revision,idempotencyKey,decision:'APPROVED'|'REJECTED',note}`；另一位 ADMIN/FINANCE 复核当前报价；批准进入 REVIEWED，拒绝退回 DRAFT。 |
| POST | `/admin/order-renewals/:id/publish` | `{revision,idempotencyKey}`；重核真实来源及正式批准发布的 `OFFLINE_ORDER_AMENDMENT`，冻结确切正文/模板摘要，建立 OFFLINE、DRAFT 的 AMENDMENT Contract；变更进入 AWAITING_CONFIRMATION。 |
| POST | `/admin/order-renewals/:id/cancel` | `{revision,idempotencyKey,reason}`；只限 DRAFT/REVIEW_PENDING/REVIEWED/AWAITING_CONFIRMATION 且未客户确认、未准备资金，变更进入 CANCELLED；不能撤销已确认或有款未来段。 |
| POST | `/customer/order-renewals/:id/confirm` | `{revision,idempotencyKey,quoteId,quoteRevision,commercialHash,bodyHash,lessorHash,noticeHash,sharingAccepted:true}`；quoteRevision≥1，逐一匹配当前报价、正文、出租方及告知，并检查当前 terms/privacy 同意；返回同形 receipt，变更进入 AWAITING_ARCHIVE。 |
| POST | `/customer/order-renewals/:id/reject` | `{revision,idempotencyKey,reason}`；本人当前待确认报价，返回同形 receipt，变更进入 REJECTED。 |

确认不等于纸质签署，不启动电子签，不伪造 SIGNED；发布与确认时均重核实际来源。未知提交结果应保留原 body/key，仅按同命令重试；收到成功 receipt 后详情 GET 失败只重试 GET，不能重发 POST。409 保留输入，刷新版本/商品/preview 后由操作者重新确认；不得静默替换 revision 后重提。会话、岗位或记录变化以及401/403/404应清除旧私有数据和待提交状态。

### 列表、详情及各入口投影

`GET /admin/order-renewals`、`GET /customer/order-renewals`：query 为 `{page,pageSize,orderId?,keyword,status?}`，page默认1且≤1000000，pageSize默认12且≤100；keyword最长100字，按续期变更 ID 包含筛选。status允许 `DRAFT/REVIEW_PENDING/REVIEWED/AWAITING_CONFIRMATION/AWAITING_ARCHIVE/AWAITING_FINANCE/SCHEDULED/APPLIED/CANCELLED/REJECTED`。客户范围始终叠加本人customerId。返回 `{items,total,page,pageSize}`；item 为 `{id,orderId,kind,status,revision,reason,createdAt,blockers,quoteSummary}`，quoteSummary可空，非空为 `{id,revision,newStartDate,newEndDate,months,monthlyFeeAmount,depositAmount,productName,commercialHash,expiresAt,confirmationExpired}`。

`GET /admin/order-renewals/:id`、`GET /customer/order-renewals/:id` 返回：

- 顶层 `{id,orderId,kind,status,revision,reason,createdAt,quote,contract,history,stage,blockers}` 及 `canQuote/canReview/canPublish/canCancel/canPrepareFinance/canSchedule/canActivate/canConfirm/canReject/canSign/canSync`；后两项固定false。能力值用于呈现，写接口仍重新校验。
- `quote` 可空；非空含预览白名单，再加 `id,revision,status,commercialHash,productName,expiresAt,reason,settlementExplanation,cancellationTerms,document,confirmedAt`。后台另有 `createdBy,reviewedBy,reviewNote`；客户不返回这些内部审核字段，未发布/未确认候选不呈现为客户可确认报价。
- `document` 为 `{id,type,version,templateHash,bodyHash}`；ADMIN/OPERATIONS及本人客户可读确切 `content`，FINANCE 工作区详情仅返回文书元信息。没有原始 `source/renewalTerms` 全快照、资格证件、合作分账依据或完整资金快照。
- `contract` 可空，非空为 `{id,kind,executionMode,status,delayQuoteId,offlineArchiveId}`。档案 ID 只来自真实 Contract；客户端继续读取档案并核对真实 subject/quote，不能猜档案 ID。`history[]` 仅 `{id,revision,status,commercialHash}`；客户历史限 PUBLISHED/CONFIRMED/SUPERSEDED。
- `stage` 可空，非空为 `{id,status,revision,startDate,endDate,firstPeriodSequence,lastPeriodSequence,scheduledAt,activatedAt}`；未来 PREPARED/SCHEDULED 与当前 ACTIVE 分开。PC办理、客户小程序阅读/确认和合作商H5只读各用专门投影，不把后台 DTO 原样发往外部。

### 纸质补充协议、财务准备与显式生效

纸档复用既有 `/admin/offline-archives` 流程，创建输入中 `kind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:quoteId`，连同真实 `templateId,revision:0,idempotencyKey`。正文为客户已确认的确切 Contract.body，原合同链、模板、报价商业摘要及签字件 manifest/pin 须匹配。共同模板必含 `{{changeFacts}}`、`{{periodSchedule}}`、`{{financialSchedule}}`；不自动批准或发布草案。按原 prepare/confirm-print/upload/submit/review/archive 办理后，只有真实归档使对应续期进入 AWAITING_FINANCE；档案失效/更正须重核。原纸号来自已验证 RENTAL 的精确归档版本，打印元信息不改客户确认正文/hash，打印包含三方签署框。

| Method | Path | 输入/输出 |
| --- | --- | --- |
| GET | `/admin/order-renewals/:id/finance-preview` | `{changeId,revision,orderRevision,accountRevision,stageId,previousStageId,startDate,endDate,periods,archiveVersionId,commercialHash,previewHash}`；只读核对真实已确认/已归档来源。 |
| POST | `/admin/order-renewals/:id/finance/prepare` | `{revision,idempotencyKey,orderRevision,accountRevision,previewHash}`；返回 `{changeId,revision,stageId,stageRevision,status:'PREPARED'}`。只建本段未来 SUBSCRIPTION 账单及 inactive obligations，不移原有效条款、不挪旧款、不发gift。 |
| GET | `/admin/order-renewals/:id/schedule-preview` | `{changeId,revision,orderRevision,accountRevision,stageId,stageRevision,status,startDate,endDate,ready,blockers,rows,depositAmount,priorDueBillIds,previewHash}`；rows为 `{sequence,stageSequence,amount,dueDate,billId,status,paidAmount,funded}`。 |
| POST | `/admin/order-renewals/:id/schedule` | prepare输入再加 `{stageId,stageRevision}`；核实续期首期全额到账、原押金及旧已到期义务、无未知收退款/对账冲突；返回 `{changeId,revision,stageId,stageRevision,status:'SCHEDULED'}`，仍不改变当前规则。 |
| GET | `/admin/order-renewals/:id/activation-preview` | `{changeId,revision,orderRevision,accountRevision,stageId,stageRevision,previousStageId,previousStageRevision,assignmentId,startDate,endDate,effectiveAt,periods,ready,blockers,previewHash}`；未到起日或整段已过期明确阻断。 |
| POST | `/admin/order-renewals/:id/activate` | schedule输入再加 `{previousStageRevision,assignmentId}`；返回 `{changeId,revision,stageId,stageRevision,termsVersionId,status:'ACTIVE',effectiveAt,activatedAt}`。有效日与真实办理时间分别记录，变更记录状态为 APPLIED。 |

上述 revision 分别对应续期变更、订单、用量账户及新/前服务段，不能互换；previewHash也不能跨动作复用。激活在订单/账户/实际车辆来源锁内重新检查，上海起始日之前不生效，整段过期不能补造历史。激活只追加本段有效条款、UsagePeriod/真实 assignment 的 segments并启用本段义务，前段 ENDED；不造新交接或里程、不改原 snapshot/旧月价。旧 FREE 按原期到期，新段 gift 独立；历史 PAID 次数保留各自原期限与金额。

### 分阶段账单付款与历史资金

没有独立“续期付款”捷径，复用本人账单 `POST /customer/bills/:id/pay {idempotencyKey}` 与既有可信支付回调/查询。分阶段 `SUBSCRIPTION` 必须匹配真实 stage、原续期 quote、归档 pin、全局月号和唯一来源义务。PREPARED/SCHEDULED 时仅新段第1期可提前付；ACTIVE/ENDED 的原续期义务如已被后来换车替换，拒绝继续新付/分配，历史到账仍保留原来源。

带 stage 的 `SWAP_ADJUSTMENT` 另核真实已准备换车报价、同段义务、原分配净本金和新增补差，发行序号不当作服务月号。当前新付款/分配守卫与历史 `HISTORY` 来源校验分开：后续换车或续期不抹掉先前已核实实收及其收益来源。支付发起在调用渠道前后校验；可信回款若来源被替换、纸档失效或取消 hold，仍记录真实 SUCCEEDED，并进入 reconciliation，不因条件变化吞掉到账、不继续错误分配。重复成功回调不重复分配；历史读取不等于允许继续付款。原期合法账单不会仅因存在未来续期而被整单冻结。上述为已接入源码行为，仍受整体发布/支付配置和实际来源守卫约束。

### 合作商 H5：仅 GET 的当前、未来和已归档信息

现有独立合作商入口使用 `GET /owner-h5/owners/:ownerId/workbench?page=&pageSize=`（page默认1、≤1000000；pageSize默认20、≤100）与 `GET /owner-h5/owners/:ownerId/orders/:id/workspace`。先核当前 portal会话/授权版本及该订单真实客户共享同意，列表/total在共享范围内分页；不冒充客户或后台人员，不初始化服务段。

详情/列表item为 `{ownerId,accessVersion,orderId,orderStatus,vehicle,originalContract,currentPeriod,futureRenewals,amendments,blockers,readOnly:true}`：

- `vehicle` 可空，仅 `{id,title,plateNumber}`。`originalContract` 可空，包含 `{id,executionMode,contractNumber,archive}`；合同编号只取完整有效链绑定的真实原 RENTAL 版本，不能拿 Contract内部ID或任意最新纸档代替。
- `currentPeriod` 可空，包含 `serviceStageId` 及 `{startDate,endDate,months,monthlyFeeAmount,depositAmount,productName,baseAllowanceKm,excessPriceAmount,includedSwapCount}`。只读真实当期 ACTIVE 段；无 stage 的旧订单按已核验有效条款的延期后日期显示，里程与赠送仍保留原冻结政策，不使用换入产品默认值覆盖。
- `futureRenewals[]` 只纳入本人授权订单的当前已确认、未生效续期，含 `changeId,quoteId,contractId,serviceStageId,status`、同形条款摘要、`confirmedAt,archive`；PREPARED/SCHEDULED不会显示成当前已生效费率或gift。
- `amendments[]` 仅已确认/历史已准备且具有可读档案的补充协议索引 `{changeId,kind,quoteId,contractId,status,confirmedAt,archive}`。`archive` 为 `{id,kind,currentApprovedVersionId,versions,canRead:true}`；version仅 `{id,version,status,contractNumber,signedOn}`，保留 INVALIDATED历史标记，不把失效纸档包装成正常有效编号。

H5投影不返回正文/完整业务来源、客户证件、内部审核、收款或成本快照；文件继续走原专用只读路径并重核授权/父级/资产文件隔离。此入口不提供确认、签署、sync、激活或业务写入；该只读投影已接现有工作区源码，仍须当前会话及共享范围有效。

### 未开始续期取消：期前约定、纸档与逐笔全退

用户确认：双方实际在新增租期开始前同意取消，新增续期实收全额退还、不收取消费。办理退款/归档可跨起租日，且新期持续不生效；须保存真实同意时间及证据，不能以创建取消案时间替代。已激活或已产生新期使用记录不适用。原押金和原期账款不改。

实际入口、严格字段、岗位、纸档和完成后迟到款恢复详见[续期取消 API](api-renewal-cancellation.md)。OPEN 阻断本次续期 prepare/schedule/activate 和新支付/分配；历史真实到账仍记录并进入核账，不能吞款。完成必须净实收归零且无未知收退款、纸签证据齐备及独立财务核账；只 VOID 本次未来服务段及其未付账单，不重用月号。完成后原关闭请求若可信晚到，仅专用全退，不重开取消、不改完成快照。

车辆资产、BAAS、折旧策略和内部成本的新增契约见[资产 API](api-vehicle-assets.md)，本地验证状态见[施工证据](evidence/ninda-admin-rebuild-20261031.md)，未部署。

残值样本、CSV 导入、统计曲线、单车预测及人工估值的本地接口见[残值 API](api-residual-market.md)，相关页面已完成本地专项验证。

内部事故/维修/保养、运营限制、费用来源及财务关单接口见[内部工单契约](api-internal-work-orders.md)。运营凭据和财务凭据分域，人工保险/付款记录不改变客户账单或渠道支付。

逾期账单、催收案件及人工联系记录见[催收 API](api-collections.md)。金额基于可信收退款事实；联系记录仅留痕，不外发短信或消息。

纸质补充协议、未交付延期、当前生效链及 FIELD 批次见[线下订单变更契约](api-offline-order-changes.md)。当前 OFFLINE 新建、自动报价预览和付费次数能力见[线下换车上线接口](api-offline-swap-launch.md)；本地源码能力与生产开放状态分别记录，不能以分包测试代替上线验收。

## 客户来源与车辆运营限制（本地验证，未发布）

- `GET/PATCH /admin/customers/:id/source` 仅当前 ADMIN/OPERATIONS；返回 `{customerId,sourceChannel,sourceRevision}`。PATCH严格为 `{sourceChannel:string|null,sourceRevision,reason,idempotencyKey}`，来源trim后1–64字，null明确清除，理由必填。独立版本CAS、客户行锁、幂等与前后审计同事务，来源不改变资料版本或qualification hash。历史来源不推测回填。
- `GET /admin/customers?sourceChannel=…` 仅 ADMIN/OPERATIONS 可按来源包含筛选，与姓名/手机号keyword叠加，列表和总数相同过滤。FINANCE/SUPPORT/FIELD不得用筛选推断来源；前两者的普通客户投影不增加来源字段。客户自助profile及通用客户PATCH不能改来源。
- 车辆运营限制以 VehicleOperationalRestriction 当前 ACTIVE 及具体 scopes 为准；ALLOCATION 阻断目录可申请性、提交申请、最终确认分配和换车目标锁定；DELIVERY 阻断交车/换车交付。实际写入在车辆锁后再次检查，不因电子或线下合同模式而跳过。正常归还不因这两类限制被阻断，只有明确解除事实才恢复对应动作。对客仅通用限制提示，不返回内部工单ID或维修原因。

## 2026-10-31 年款与合同期换车次数增量（本地验证，未发布）

- 车型主数据增加可空 `modelYear`（1900–2100）和 `revision`。创建、修改、停用均带 `revision/idempotencyKey` 并重核当前工作人员；年款未知可为空，不以车辆年份或上牌年份推断。车辆资料仍是独立事实。
- 原订单为模块化产品时，从原 `finalPlanSnapshot.productSnapshot` 冻结 `SWAP_TERM_V2` 政策：`includedCount/extraFeeAmount/sourceHash`。缺少产品身份、政策或摘要不回退年度规则。合同期赠送按实际预占逐条创建，读取及重复命令不增加业务版本，也不按赠送数量批量建行；合同跨年不刷新赠送次数。历史 v1 年度账本和既有购买金额保持。
- v2 只读换车账户返回 `policyVersion` 与 `term:{startDate,endDate,includedCount,remaining,reserved,consumed,available}`；预约与流水用 `scope:'TERM'`、`termSequence` 标识。`remaining` 含预占未消费次数，`available` 另扣预占并受有效用车状态约束。旧 OFFLINE 订单无年度赠送依据时不展示年度承诺，保留真实历史流水。
- v2 额外次数商品为 `SWAP_CREDIT_TERM_1`，价格冻结为 `{policyVersion:'SWAP_TERM_V2',sourceHash,quantity:1,amount,currency:'CNY'}`，金额取原订单产品的单次服务费；`pricingHash` 是该快照规范化摘要。付款、重复到账、晚到款、恢复和退款按本购买、原账单与原支付链核对冻结金额，不读取当前产品价格；原 v1 空快照仍严格为80000分。
- 新购买条款类型 `swap-credit-v2`，条款版本 `SWAP_CREDIT_V2`。已批准模板必含 `{{extraFeeYuan}}`，可选 `{{extraFeeAmount}}`；模板及渲染正文摘要分别冻结。前端提交绑定当前价格摘要、已阅读的具体文书及稳定幂等键，未知或不完整字段拒绝提交。草稿见 `docs/legal/drafts/ninda/swap-credit-v2-configurable-20261031.md`，尚未在线启用。
- 当前源码已接通基于真实纸档、资格及实际分配的新建 OFFLINE 换车；付费次数另受明确开关、当前服务段、冻结产品价格及独立条款同意约束。自动差价、逐笔资金、纸档和双侧实际交接继续沿独立门槛办理，详见[线下换车上线接口](api-offline-swap-launch.md)。实际发布状态见施工证据。

### 资产专用文件边界（本地已验证）

- `POST/GET /admin/baas-contracts/:id/files`、`/admin/depreciation-policies/:id/files`、`/admin/asset-costs/:id/files`、`/admin/license-plates/:id/files`、`/admin/residual-observations/:id/files`、`/admin/vehicle-valuations/:id/files`、`/admin/asset-work-orders/:id/files`、`/admin/asset-work-order-cost-lines/:id/files`；具体下载追加 `/:fileId`。列表 `{items,revision}`，单份元数据 `{id,name,mimeType,size,sha256}`；上传另返回新 `revision` 与专用 `url`。不返回存储路径。未绑定车辆的牌照、独立市场样本均可上传自身依据。
- multipart上传包含 `file/revision/idempotencyKey`，单份不超过10MiB，JPEG/PNG/PDF按实际内容校验。上传前与磁盘写入后分别重核当前工作人员权限；关联文件、递增父版本、审计及幂等在同一事务。同键不同字节摘要冲突；成功回放不再递增版本。已锁定成本不能再添加附件。
- BAAS、市场样本和运营工单文件ADMIN/OPERATIONS可写，FINANCE可读；折旧、内部成本与工单费用行文件仅ADMIN/FINANCE；牌照文件仅ADMIN/OPERATIONS；估值复核文件ADMIN/OPERATIONS/FINANCE可读写，但只有PENDING可上传。已作废样本、CLOSED/CANCELLED工单、FROZEN费用行不可追加凭据。读取验证专属父对象、八种父映射恰一、用途、实际上传人和摘要，不能借其它父记录下载。历史终态仍按当前权限读原凭据，成功旧命令回放不追加附件。SUPPORT/FIELD不增加资产权限。
- 资产文件不得经通用后台、客户或公共媒体入口读取，即使用途字段被错写或文件ID被加入车辆图片列表，专属映射仍阻断。跨域业务引用和H5/FIELD文件路径另执行同一映射隔离，不扩大原授权范围。

## 2026-10-31 模块化产品与用量增量（本地验证，未发布）

- 产品写入支持严格v1/v2两种配置。v2明确`configurationVersion:2`、`baseFeeAmount`、`mileageMonthlyFeeAmount`、`mileagePerMonthKm`、`excessMileagePriceAmount`和`swapPolicy:{version:2,period:'TERM',includedCount,extraFeeAmount}`；沿用name/months/conditions/vehicleIds/modelDefinitionIds/items/revision/idempotencyKey。金额均为整数分；月费服务端计算为基础费加里程包月费，合计须为正且不超Int上限。各模块金额、公里数、赠送次数可为0；额外换车单次费须为正。v2不能提交monthlyFeeAmount或energyDescription覆盖派生值，自付能源固定。旧v1快照结构不加字段、不变摘要。
- `POST /admin/products/:id/versions/:versionId/suspend|resume`：`{revision,idempotencyKey,reason}`，reason必填且≤500字符。暂停关闭新售；恢复仅激活仍PUBLISHED的商品，不重新上架WITHDRAWN/DRAFT。已成立订单不变。
- 最终方案的里程与单价来自关联商品，逐单输入须与冻结规则相同；公开商品与最终方案product摘要仅在v2附加月费组成和swapPolicy。产品价格改动须新版本。换车规则此阶段只冻结到订单，实际变更办理仍须后续完整闭环。
- v2方案要求已批准发布的`usage-policy-v2`模板，必含`{{baseAllowanceKm}}`及`{{excessPriceYuan}}`，可用`{{excessPriceAmount}}`；未知或残缺变量拒绝。`usagePolicyVersion:'USAGE_V2'`；usagePolicy冻结templateContent/templateHash及代入后的content/hash、文档ID/版本、每月公里和超额分单价。未发布模板返回`USAGE_POLICY_UNPUBLISHED`，不得回退v1。
- 用量账户与每期`pricingSnapshot`冻结原订单policyVersion/baseAllowanceKm/excessPriceAmount/sourceHash；sourceHash为原订单usagePolicy规范化摘要，不输出给客户端充当计价输入。v2缺失或错绑定/错摘要返回`USAGE_PRICING`。v1历史空快照继续原1500公里/150分，不伪造回填。有效条款暗改原里程政策返回`USAGE_POLICY`。
- 客户及后台用量只读投影按账户/期间返回policyVersion/baseAllowanceKm/excessPriceAmount。超额计算按冻结单价使用整数分，超出Int范围返回`USAGE_AMOUNT_OVERFLOW`并回滚全部结算写入。历史读数、包抵扣、退款、幂等及权限门禁保持。


## 2026-10-31 显式商品发布增量（本地施工，未发布）

产品发布只使不可变产品版本进入仓库，不再自动为所有适配车辆生成可售套餐。商品为具体车辆与明确产品版本的组合，保留稳定的 `subscriptionPlanId` 兼容原客户端。一个物理车辆可以有多个商品，但确认订单仍在事务中锁定同一车辆，只允许一份有效占用。

- `GET /admin/goods?keyword=&status=&page=&pageSize=` 和 `GET /admin/goods/:id`：商品列表与详情，返回车辆身份白名单、产品版本和套餐条款摘要，不提供客户资料及内部成本。仅ADMIN/OPERATIONS具有goods读写权限。
- `POST /admin/goods`：`{vehicleId,productVersionId,visible,recommended,sortOrder,revision:0,idempotencyKey}`；仅可组合已发布且适配的产品版本，创建DRAFT商品和active=false的兼容套餐。相同车辆+产品版本唯一。
- `PATCH /admin/goods/:id`：只能修改visible/recommended/sortOrder，带revision/idempotencyKey，不能替换车辆或产品版本。
- `POST /admin/goods/:id/publish`、`POST /admin/goods/:id/withdraw`：带revision/idempotencyKey及可选reason。状态为DRAFT/PUBLISHED/WITHDRAWN，下架后可核对原版本重新发布，兼容套餐ID不变。商品隐藏与下架均阻止新申请。
- 公开目录、客户首页和申请方案共用商品校验。商品必须已发布、可见、关联一致，产品版本仍已发布且适配；不能回退到未组合的适配产品。公开方案增加`listingId,listingRevision,sourceHash`。
- 最终方案产品快照冻结商品ID、版本及来源摘要。待确认方案遇到商品版本变化需重新审核；已成立订单继续使用冻结条款，幂等确认不回写历史。
- 迁移仅为既有active且产品版本PUBLISHED的套餐建立`LEGACY_MIGRATED`等价商品，不推断额外组合或虚构原上架时间。重复有效车辆+产品版本必须先核对，不能静默择一。新`EXPLICIT`商品必须保留完整产品快照及摘要；来源类型不可由客户端指定。

本节只表示本地已开始实现的商品契约，不表示模块化产品、可配置里程、换车账本或上线已完成。

## 2026-10-31 人工资料审核增量（本地施工，未发布）

用户暂停实名认证实现，客户上传身份证正反面、驾驶证并补齐基本信息后可提交申请，由运营按既有资格与风控流程审核。四入口包括 PC、客户小程序、合作商 H5、FIELD。本节仅覆盖身份办理政策，不变更支付、合同归档及交付条件。

- `CUSTOMER_IDENTITY_POLICY=MANUAL_REVIEW|PROVIDER_REQUIRED`，缺省 `PROVIDER_REQUIRED`，未知值配置错误。宁达本轮采用 `MANUAL_REVIEW`；需完成验证及发布才对线上生效。
- `GET /customer/profile` 的 `readiness` 新增 `identityPolicy`；人工模式核对分类文件、本人归属、姓名和驾龄，资料齐全时 `readyForApplication=true`，`realNameVerified=false`，不依赖法大大账户或解密。人工资格通过也不能写成线上实名成功。
- `GET /public/identity-config` 新增 `identityPolicy`，人工模式强制关闭新实名入口、供应商地址及刷脸能力，细分开关不能越过总政策。旧入口直接调用同样拒绝新办理；历史文件、回调和已冻结事实保留。
- 人工模式新资料快照为 `version:2,identityPolicy:'MANUAL_REVIEW',identity:null`，其余文件摘要、客户资料版本、归属和冻结规则保持。历史 v1 快照按原值解析；尚未确认且跨政策的申请返回资料变化冲突，由运营退回补件再审核；已成单不自动修改历史凭据。
- 小程序提示“未进行线上实名认证，由运营审核资料”，不收集用于新线上实名的证件号码，不启动实名或主动查询供应商。未知配置不被解释成人工模式；缺资料仍不能继续申请。
- 普通救援/事故与权益工单均传所选 `orderId`，服务端校验本人订单；不能因无 `entitlementId` 丢失订单关联。

历史段落与本节冲突时，以本节对应政策为准；PROVIDER_REQUIRED 保留原有可信实名要求。

2026-10-28客户资料更新以本文“客户资料与独立实名”及“VIN与车辆身份”两节为准，替代旧账户设置及未分类附件提交方式。实施和发布状态见[客户资料操作说明](operations/ninda-customer-profile-review.md)及[设计基线](superpowers/specs/2026-10-28-customer-profile-order-design.md)。合作商v2.3规则保持不变。

**v2.3 已于2026-10-28上线。** 合作事项由运营直接办理，不要求分权复核；仅协议原件、明确分润比例、车辆绑定为有效合作必填，管理员手机号通过邀请码本人确认。新契约见[合作商简化办理 API](api-partner-simple.md)及[v2.3设计](superpowers/specs/2026-10-28-partner-simple-cooperation-design.md)。下方 v2.2 的合作审核、专项能力和人工结算流程仅作历史兼容，不作为新流程前置；非合作业务的原权限不随之扩张。[发布核验记录](evidence/ninda-partner-simple-v23.md)。

**v2.2已实现并通过独立审阅及254项API回归，生产状态以[实施与发布记录](evidence/ninda-partner-operations-v22.md)为准。** 详见[设计基线](superpowers/specs/2026-10-28-partner-operations-readonly-design.md)、[实施计划](superpowers/plans/2026-10-28-partner-operations-readonly.md)及[七模块v2.2接口附录](api-seven-module-mvp.md#v22接口附录合作运营与手机号只读查看)。下文v2.1及历史签署说明仅作兼容参照；被v2.2替代的路径不能作为新办理流程。代码或文档发布不等于真实合作、查看授权或业务审核已经生效。

平台主体为上海宁达信息科技有限公司。当前新订单固定 `OFFLINE`，不调用法大大；旧 `ESIGN` 记录保留原执行模式、已签文件和受控核对。客户查验确认不代表合同签署。合作商包括企业和个人，当前分润按运营登记比例及净实收租金自动统计；统计不表示已经向合作商付款。

新命令使用 `revision` 和 `idempotencyKey`；同键同内容返回原结果，同键换内容返回409，旧版本冲突要求重新读取。合作协议保留不可变版本，ADMIN/OPERATIONS直接登记；非合作模块原有审核分权要求继续适用。服务端每次变更重新核验权限与会话版本。客户和合作商返回各自白名单：客户不读取内部风控和合作商分润；合作商仅可读取本授权公司的已共享协议、车辆状态与分润统计，不读取客户身份、内部风控、收款账户或文件存储路径。

客户端首页/车辆、订单、用车、我的；合作商 H5 合作概览、车辆、分润；后台七模块加工作台、财务和人员设置。公司管理员从服务号“企业服务 → 合作商中心”进入 `/owner/`；FIELD从现有“员工入口 → 车辆交接”进入 `/field.html`，仅操作分配给自己的交接任务。

基地址 `/api`。原生客户使用 `Authorization: Bearer <session>`；后台使用 HttpOnly Cookie，修改请求携带 `X-CSRF-Token`，服务端校验 Origin。JSON 错误为 `{error:{code,message,details?},requestId?}`。金额整数分；时间 ISO8601，业务时区 Asia/Shanghai。成功列表统一 `{items,total,page,pageSize}`，客户展示聚合返回原 Mock services 对应展示模型。

## v2.2实现边界

- 宁达运营依据真实线下资料办理合作主体、车辆、档案、分润、账户、结算和实付登记；合作资料草稿、准入及可申请资格不再以 `Customer`、`PartnerIdentityBinding`、H5登录或在线实名为前置。必要主体、签署代表与车辆出租权限核验纳入合作资料独立复核；缺失事实不自动通过。
- 后台配置独立的合作商只读手机号授权：`/admin/partners/:ownerId/portal-access`及`/submit|review|disable`是**新增目标路径**。保存候选、提交、独立启用与紧急停用分开；换号/范围变化/停用/重启更新访问版本，不改商业主体版本和冻结订单。外部查看账号不是平台ADMIN，不是客户账户，也不因同号成为企业签署代表。
- H5继续使用 `/owner/` 和 `/owner-h5`接口前缀；目标 `PARTNER_READONLY` 会话无Customer外键前置。短信请求返回不可推断 `challengeId`，登录须同时校验手机号、验证码、挑战中的授权版本及当前授权，再一次性签发独立会话。旧验证码不能因号码改回、重新启用或新增范围获得新权限。
- 只允许目标附录逐项列明的GET及三个认证POST（短信请求、登录、退出）。合作商反馈、claim、资料/身份刷新、授权、签署、sync等业务写入由服务端拒绝，旧会话也不例外；查询不得调用供应商或触发审批/资金副作用。不存在路径仍404。客户自己的业务及独立供应商回调保持原受控入口。
- 运营按合作业务经办/复核/敏感读取能力办理，固定角色名和菜单不构成授权。ADMIN配置员工并遵守自审禁令；以ADMIN核对的内部稳定人员标识/账号归属防止同一人多个账号互审，不按姓名/手机号推断，也不额外采集身份证。旧FINANCE账号由管理员明确映射授权，不自动提权。SUPPORT/FIELD以及非合作领域的既有资金权限不扩张。
- 保留原业务ID、历史身份/反馈、账本、旧 `lessorIdentityHash` 解释及客户逐单 `ownerDataConsent`。新快照显式版本化，不重算旧已签摘要、不代补客户同意；新查看手机号不替代订单共享授权。详细目标DTO、能力键、只读路径白名单和迁移规则统一以[七模块v2.2附录](api-seven-module-mvp.md#v22接口附录合作运营与手机号只读查看)为准。

以下各节继续记录v2.1与历史兼容。合作商流程以v2.2附录为准；未覆盖的产品、客户、支付、保险、FIELD等契约保持原意。

## 公开与客户

| Method | Path | 输入/输出 |
| --- | --- | --- |
| GET | /health | `{status,version,database}` |
| GET | /public/vehicles | query brand,keyword,page,pageSize；车辆列表 |
| GET | /public/vehicles/:id | 车辆、可售套餐、车况和媒体 |
| GET | /public/model-definitions | 车型列表 |
| GET | /public/legal/:type | 已发布协议 `{id,type,version,title,content}` |
| GET | /public/signing-config | `no-store`；新单模式、有效新电子签能力及已核验原生渠道配置，见下述说明 |
| POST | /customer/auth/wechat | `{loginCode,phoneCode}` → `{token,expiresAt,customer}` |
| POST | /customer/auth/sms/request | `{mobile}` → `{sent:true}`；不可回传验证码 |
| POST | /customer/auth/sms/login | `{mobile,code,loginCode?}` → 同上；支付前须取得本小程序 OpenID |
| POST | /customer/auth/logout | 撤销当前会话 |
| GET | /customer/context | 客户会话及 profile |
| GET | /customer/home | 原 getHome 展示模型 |
| GET | /customer/dashboard | 原 getDashboard 展示模型 |
| GET | /customer/profile | 本人资料版本、分类证件、附件及申请就绪状态 |
| PUT | /customer/profile | `{revision,idempotencyKey,name,drivingYears,identityFrontFileId?,identityBackFileId?,drivingLicenseFileId?}`；手机号只读 |
| POST | /customer/files | multipart file, purpose → `{id,name,url,mimeType,size}` |
| GET | /customer/files/:id | 归属校验后文件 |
| POST | /customer/applications | `{vehicleId,subscriptionPlanId,profile,consents:[{documentId,version}],idempotencyKey}` |
| GET | /customer/applications/:id | 原 getApplication 展示模型 |
| POST | /customer/applications/:id/cancel | `{reason?}` |
| POST | /customer/applications/:id/confirm | `{revision,commercialHash}` → 订单信息 |
| POST | /customer/applications/:id/reject | `{revision,reason}` |
| GET | /customer/records/:type | 类型 applications,orders,contracts,bills,payments,deposits,entitlements,notifications,services |
| GET | /customer/records/:type/:id | 原 getRecord 展示模型；动作由服务端提供 |
| POST | /customer/contracts/:id/sign | `{}` → `{taskId,url?,miniProgram?,status}` |
| GET | /customer/contracts/:id/sign-status | 真实签署状态 |
| POST | /customer/bills/:id/pay | `{idempotencyKey}` → `{paymentId,timeStamp,nonceStr,package,signType,paySign}` |
| GET | /customer/payments/:id | 真实付款状态 |
| POST | /customer/notifications/:id/read | 持久化已读 |
| POST | /customer/services | `{type,location,description,mobile,fileIds,idempotencyKey}` |
| POST | /customer/services/:id/cancel | `{reason?}` |
| POST | /customer/mileages | `{orderId,readingKm,recordedAt,fileIds,idempotencyKey}` |
| GET | /customer/handovers/:id | 证据、清单哈希、确认/签署状态 |
| POST | /customer/handovers/:id/confirm | `{manifestHash,readFileIds,idempotencyKey}` |
| POST | /customer/handovers/:id/object | `{manifestHash,reason,fileIds,idempotencyKey}` |
| POST | /customer/handovers/:id/sign | 与合同签署结果格式相同 |

匿名首页可从公开目录组合，客户 home/dashboard 需会话。原页面上传后的 fileId 应随业务请求提交，不能把外部 URL 直接当私密附件。所有客户 ID 均取自会话，不接受前端指定归属。

### 上线入口一致性（2026-10-28）

`OFFLINE` 的公开车辆列表、车辆详情/套餐与登录后首页推荐共用可申请资格：已上架、无占车/占用、当前有效发布产品，并且实际出租方准入与车辆权属已审核、当前归档合作协议和已批准分润规则覆盖车辆及产品租期。申请 DTO 尚无实际起租日，预检按北京时间当前日期和所选产品的月份计算；不将该日期写成客户起租日。后台发布真实方案及客户确认时，继续校验实际完整租期。保单仍在交车前校验，不提前变为申请必备条件。

运营上架状态不被可申请资格反写。合作资料不足时保留可浏览的上架车辆，返回 `available:false`、`statusText:"暂不可申请"`；提交事务再次检查资格，拒绝信息不暴露内部身份、协议或分润明细。正常幂等重试仍读取原结果。

公共签署配置保留 `mode:"MINIAPP_WEBVIEW"`，新增 `newOrderContractMode:"OFFLINE"|"ESIGN"`、`newEsignRequestsEnabled:boolean`。后一字段仅在新单模式为 `ESIGN` 且服务端新增电子签总开关开启时为 true；`enabled` 还要求原生签署子开关开启。`signProviderConfigured` 仅表示渠道配置已核验，不是发起签署的授权；刷脸能力同时受有效 `enabled` 限制。

客户端缺失、未知或畸形配置时关闭新电子签办理，正常登录、公开协议、本人资料和账单不依赖供应商。独立实名认证使用下述能力与接口，个人资料页读取已存核验状态，主动办理或查询才访问供应商。历史合同及文件保留冻结模式与真实状态，新办理能力关闭时不显示可签/可确认动作，旧缓存与深链不得重新启用供应商 URL。普通恢复不查询旧签署供应商，支付恢复按原规则独立处理。

### 客户资料与独立实名（2026-10-28）

`GET /customer/profile` 返回 `revision,name,mobile,drivingYears`、三个独立的 `identityFrontFileId,identityBackFileId,drivingLicenseFileId`、`files` 以及 `readiness`。`files` 含 `identityFront,identityBack,drivingLicense` 三个可空的文件对象和 `legacy` 未分类数组；文件对象为 `{id,name,mimeType,size,url}`，URL仍需本人会话。`readiness` 为 `{profileComplete,realNameVerified,readyForApplication,missingFields,blockers:[{code,message}]}`。仅服务端可信核验且与当前姓名一致才视为已实名。

保存资料使用上表中的严格DTO，允许先保存不完整资料。缺少版本和幂等键的旧客户端返回409 `CLIENT_UPDATE_REQUIRED`；旧版本返回409 `REVISION_CONFLICT`。姓名和驾龄保持原校验，手机号来自登录账户且不可由资料请求修改。每个证件槽可省略（保留）或置空（清除），三槽不能复用同一文件。附件须属于本人、用途为identity/profile/evidence且是有效JPEG/PNG/PDF；旧 `fileIds` 保留为未分类资料，不按数组顺序自动归类。未实际修改的保存不提升资料修订号，也不使有效资格凭空失效。

| Method | Path | 输入/输出 |
| --- | --- | --- |
| GET | /public/identity-config | 独立实名能力；`enabled`受CUSTOMER_IDENTITY_ENABLED及实名渠道完整配置控制，原生刷脸仅开放identity类型 |
| GET | /customer/identity/readiness | 只读当前已保存身份事实和阻塞原因，不查询供应商、不含身份证号或证书状态 |
| POST | /customer/identity/register | `{}`；注册本人实名渠道账户，不能申请签章证书 |
| POST | /customer/identity/verify | `{name,idCardNo,consent}`；姓名须与已保存档案一致，consent沿用实名单独同意结构；返回原生核验任务入口 |
| POST | /customer/identity/refresh | `{}`；查询绑定的原实名任务，不查询证书或发起签署 |
| GET | /admin/applications/:id/customer-profile | 授权审核人员读取该申请的快照及当前补充资料 |
| GET | /admin/orders/:id/customer-profile | 授权审核人员读取该订单的快照及当前补充资料 |
| GET | /admin/applications/:id/customer-profile/files/:fileId | 该申请关联且摘要匹配的私密证件流 |
| GET | /admin/orders/:id/customer-profile/files/:fileId | 该订单关联且摘要匹配的私密证件流 |

实名写入要求当前用户协议及隐私同意；verify另需主动单独同意实名说明。`CUSTOMER_IDENTITY_ENABLED`与电子签开关独立；OFFLINE下原合同、交接、证书和电子签发起入口仍关闭。可信核验必须与供应商账户、原任务、加密身份摘要及QUERY/CALLBACK来源匹配，客户端回跳和刷脸页面返回不能直接更新为成功。证件号码不得进入前端持久存储、日志或后台只读DTO。

新申请/补件在事务中读取客户本人资料，检查分类证件与实名并冻结 `customerProfileSnapshot`，不信任客户端声称的姓名、文件或实名状态。快照v1含 `captureStage,capturedAt,profileRevision,profileHash,name,mobile,drivingYears,documents,identity`；documents冻结每类文件ID和sha256，identity仅保留provider、identityVersion、verifiedAt及identityHash。确认方案时重新核对当前资料与原快照，变化返回409 `CUSTOMER_PROFILE_CHANGED`，由运营将原申请退回NEEDS_INFO后补件。AWAITING_CONFIRMATION仅新增退回NEEDS_INFO路径，不扩张其他审核状态转换。正式订单复制已确认快照；已有订单幂等重试直接返回原结果。

审核专用DTO含 `source:APPLICATION_SNAPSHOT|ORDER_SNAPSHOT|CURRENT_SUPPLEMENT`、`snapshot,capturedAt,currentProfile,files,identity,qualificationStatus`。`files`与`identity`各自区分快照及当前资料；currentProfile额外提供供资格提交核对的profileHash。无快照旧单显示CURRENT_SUPPLEMENT，不回填伪造历史；旧申请确认创建新订单时捕获ORDER_CONFIRMATION快照。管理员和运营可查看；其他角色不得从通用申请/订单详情获得客户证件或快照。私密文件逐次检查当前有效会话、角色、业务关联和文件摘要。

资格审核继续独立办理。复用客户分类证件时必须携带同时读取的profileHash及三个ID，不能将新hash与旧附件拼接；证件有效期仍由运营填写。实名成功不等于驾驶资格审核通过。

### 资格有效期与申请办理进度（2026-10-29）

`POST /admin/customers/:id/qualifications` 的身份证、驾驶证有效期分别填写：

- 固定日期：`identityLongTerm:false, identityExpiresAt:"YYYY-MM-DD"`，驾驶证使用 `drivingLicenseLongTerm/drivingLicenseExpiresAt`。截止日按北京时间自然日判断，当天全天有效；界面只选择日期。
- 长期：对应 `LongTerm:true` 且对应 `ExpiresAt:null`（或省略），不生成虚构的远期截止日期。
- 两项独立选择。长期同时填写日期、固定有效期缺日期或非法日期均拒绝。旧 ISO 时间字符串继续兼容，缺省长期标记按固定日期处理，保持旧命令幂等输入，既有记录不回写日期。
- 资格读取返回两个长期布尔标记及可空日期；审核和下游资格检查使用相同的日期规则。版本冲突、材料归属、证据摘要和独立审核要求继续执行。

申请办理界面从申请详情、信用核验、客户资格、本单风控的当前结果计算“受理 → 审核准备 → 本单风控 → 客户确认 → 正式订单”。身份与驾驶资格可与信用核验并行；有效信用核验后生成候选方案，三项准备齐备后审核本单风控。受理或生成方案不代表审核通过；只有客户本人确认后建立正式订单。读取失败或结果归属、版本不一致时显示待核对；写入成功后刷新失败时保留已提交事实并提供刷新入口，不引导重复提交。

后台申请详情向 ADMIN/OPERATIONS 返回当前处理备注 `note`，用于展示补件或结束原因；客户申请投影及其他后台角色不因本次变更新增此字段。刷新期间保留当前表单输入；读取失败时禁用提交，成功取得最新事实后恢复。资料来源版本真实变化时明确提示重新核对。

小程序将登录、资料、实名、用户协议、隐私政策、客服与退出集中到“个人资料”；旧settings路径兼容跳转。资料不齐或未实名时引导补充，返回原申请保留选择，由客户再次提交。操作页面使用简短说明及勾选文档链接，协议页不含账户设置入口；冻结方案的文档按对应版本阅读，不替换成最新模板。多段内容以纯文本段落排版，不直接执行HTML。

### VIN与车辆身份（2026-10-28）

VIN是车辆唯一业务键：创建必填17位合法VIN，归一化大写，数据库唯一约束拒绝重复。普通编辑不得替换或清空已有VIN；原缺失VIN的历史档案可补齐。车牌是可变属性，换牌更新原档案；内部vehicleId及订单、保单、合作协议、分润关联保持稳定，历史快照仍保留当时车牌。已预订或占用车辆允许仅修改车牌，其他受保护变更继续拒绝。后台支持按VIN或车牌搜索。

### 客户订单只读概览（2026-10-26）

`GET /customer/home` 的 `nextAction` 优先使用当前客户最新的未终止订单（待签约、待支付、待交付、用车中、结算中），按 `createdAt desc` 选择，跳转本订单记录详情。仅无当前订单时回退未成立申请；已确认、已取消、已拒绝申请不再作为下一步。待签订单无已发起正式合同的情况下明确显示“合同准备中”，不推导可签署权限。

待支付订单的首页及订单详情共用账单引导：按本订单和当前客户查询已发布的 `PENDING/PAID` 账单。没有已发布账单时提示“账单待发布”，等待运营核对；有金额为正整数分、未付款的 `PENDING` 账单时提示进入原账单详情支付；仅已付或异常待付记录时提示资金状态核对，不要求重复付款。草稿/复核中/作废记录仍不可见；付款日不作为已发布账单的显示过滤条件。聚合页不发起交易，实际支付仍由原账单详情与支付端点核验。

`GET /customer/records/orders/:id` 保留记录顶层 `id,type,title,subtitle,status,statusText,amount,amountText,createdAtText`，只输出展示白名单。`details/timeline/actions/documents` 为空数组，由新增 `orderDetail` 提供订单专用只读视图；订单列表不执行每条详情聚合，也不输出原始 `finalPlanSnapshot` 或内部条款版本指针。其他记录类型不变。

`orderDetail` 字段：

| 字段 | 说明 |
| --- | --- |
| `version,orderId,status,statusText,createdAtText` | 当前格式版本为1；时间为北京时间的已格式化文本 |
| `vehicle` | `{title,imageUrl,originalTitle,currentState}`；currentState为CURRENT/ORIGINAL/AWAITING_DELIVERY/RETURNED。原始标识来自确认快照，不能由已更新的当前车型推断；有车辆分配历史却无当前车辆时显示“当前暂无交付车辆”（已归还时另行标记），不回退原车辆 |
| `guidance` | `{title,description}`，按订单真实阶段说明下一步 |
| `summaryRows` | `{label,value}[]`，约定月费、押金、期限、起止日期；金额原始单位为整数分，0分和1分均保留 |
| `sections` | `{id,title,rows:[{label,value}],collapsible}[]`；当前条款、实际出租方、完整交易条件、有效协议各期订阅费及原始历史方案 |
| `contracts,bills,handovers` | 下述只读关联记录数组 |

关联记录结构为 `{id,title,status,statusText,description,dateText,amountText,url,documents:[{id,title,url}],canSign,canPay}`。`url` 是现有小程序详情页，文件使用现有 `/api/customer/files/:id` 权属接口。此聚合的 `canSign/canPay` 均为false，不产生签署或付款指令；交易能力仍由进入详情后的原接口核验。合同按下述统一合同阶段显示；账单只包含PENDING/PAID；交接只包含PUBLISHED/CUSTOMER_CONFIRMED/OBJECTION_SUBMITTED/COMPLETED。

金额和条款读取订单确认快照或订单指向的有效 `OrderTermsVersion.snapshot`，禁止以实时套餐价格替代。存在有效版本时标明版本和生效时间，原始方案单独标记为历史约定；各期金额可能不同，月费摘要显示“按已生效协议逐期结算”，各期金额只作协议说明，实际支付以已发布账单为准。结束日使用既有订阅期边界规则，避免月末日期溢出。关联查询绑定订单与当前客户；无直接customerId的条款版本通过订单关系限定客户。有效版本缺失返回TERMS_MISSING，不静默退回旧快照。

### 客户合同详情与签署进度（2026-10-26）

`GET /customer/records/contracts/:id` 返回展示白名单和 `contractDetail`，不输出原始条款、供应商交易信息或身份密文。合同列表、订单关联合同及首页下一步使用相同阶段判断。仅加载页面仅读取持久化事实，不调用签署供应商。

`contractDetail` v1 包含 `version:1,contractId,orderId,kind,status,phase,phaseText,guidance:{title,description},vehicle:{title},lessor:{name},summaryRows:[{label,value}],parties:[{role,label,name,status,statusText}],progress:[{id,title,state}],documents:[{id,kind,title}],canSign,canQuery,primaryAction,createdAtText,updatedAtText,templateVersion`；`templateVersion` 为整数或 null。

阶段为 PREPARING（合同准备中）、REVIEWING（合同复核中）、READY_TO_SIGN（待您签署）、VERIFYING（签署结果核验中）、WAITING_OWNER（等待车主签署）、ARCHIVING（双方已签待归档）、ARCHIVED（已签署归档）、REJECTED、EXPIRED、CANCELLED。进度节点 state 为 DONE/CURRENT/PENDING/STOPPED；文件 kind 为 SOURCE/SIGNED；主动作只允许 `{id:'sign'|'query',label}` 或 null。

阶段须核对合同、订单、当前客户、签署任务、文件及文档摘要绑定。客户已签且有可信核验记录时，即使合同总状态仍为 PENDING，也不得提供客户重签入口；已尝试但结果未知时先查询原交易。缺失 OWNER 任务不得降级到平台签署。未知或缺失 DTO 关闭签署，补充协议仍从原订单变更流程办理。文件读取继续校验现有文件权限。

合同摘要采用冻结条款，金额整数分（保留0分、1分），时间显示北京时间。用户主动刷新且 `canQuery=true` 才调用既有签署查询并重新读取投影；查询不自动派发用印。旧 PLATFORM 查询可能派发自动用印，因此本展示页不开放该查询，仅刷新已保存状态；OWNER 查询沿用不派发用印的路径。`canSign` 等展示字段不替代签署端点的实名、状态、归属、版本及文档校验。

## 管理后台

认证：`POST /admin/auth/login {username,password}` → `{user,csrfToken}` + Cookie；`GET /admin/auth/me` → 同结构；`POST /admin/auth/logout`。

`GET /admin/dashboard` → 待办计数与最近活动。

资源根路径：`/admin/model-definitions`、`vehicles`、`plans`、`customers`、`applications`、`orders`、`contracts`、`bills`、`payments`、`deposits`、`refunds`、`handovers`、`mileages`、`entitlements`、`services`、`notifications`、`users`、`audit-logs`、`legal-documents`。列表支持 page/pageSize/keyword/status，详情 GET /:id。只有允许编辑的资源提供 POST/PATCH；财务/订单/审计状态通过明确动作修改，不能任意 PATCH。

后台账号 `POST /admin/users` 要求 `username` 为3–100个字符、`name` 非空、`password` 为8–256个字符，`role` 允许 `ADMIN/OPERATIONS/FINANCE/SUPPORT/FIELD`，`active` 为布尔值（默认true）。人员新建、管理员重置及本人修改密码统一采用8–256个字符的长度要求；密码保持输入原值；编辑不更改密码时应省略 `password` 字段，不能提交空字符串。后台表单对非空密码执行同样长度校验并显示中文原因；服务端仍独立强制校验。账号响应不含密码哈希，账号审计仅记用户名、角色与启用状态。

车辆表单字段：`brand,model,title,year,city,vin,plateNumber,mileageKm,batteryHealthPercent,description,conditionDisclosure,coverFileId,mediaFileIds,status`；VIN规则见上文。公开价格来自绑定有效套餐，不直接接受展示字符串。

**车辆私密原件档案（2026-11-03）**

以下路径均位于 `/api` 下，仅当前有效的 `ADMIN/OPERATIONS` 可访问。每次读取、上传均校验当前账号及 `authVersion`；上传在文件写入后、数据库事务内再次校验。证件、合同、付款凭证和原始照片保持私密，不自动加入车辆相册。

| 方法 | 路径 | 输入/返回 |
|---|---|---|
| GET | `/admin/vehicles/:vehicleId/documents` | `{revision,vehicleRevision,items}`；`revision` 是独立的 `Vehicle.documentRevision` |
| POST | `/admin/vehicles/:vehicleId/documents` | multipart：单个 `file`、非负整数 `revision/vehicleRevision`、`idempotencyKey`、`category`、`sourceRelativePath`；返回原件元数据、递增后的 `revision`、原 `vehicleRevision` 与专属下载 `url` |
| GET | `/admin/vehicles/:vehicleId/documents/:fileId` | 仅返回该车辆绑定的原件字节；`attachment`、`private, no-store`、`nosniff` |
| PATCH | `/admin/vehicles/:vehicleId/documents/:fileId/category` | `{revision,vehicleRevision,idempotencyKey,category}`；显式更正分类，仅原件版本递增，文件字节、名称、摘要、来源路径不变 |

元数据为 `{id,name,mimeType,size,sha256,category,sourceRelativePath,createdAt}`。类别限定 `REGISTRATION/DRIVING_LICENSE/PURCHASE_CONTRACT/INVOICE/PURCHASE/INSURANCE/BAAS/PAYMENT/INSPECTION/PHOTO/OTHER`。单文件最多32 MiB，支持经实际内容校验的 PDF、JPEG、PNG、DOCX、MP4；文件名可以保留原扩展名，实际格式不符的文件不得仅凭扩展名通过。`sourceRelativePath` 最多1000字符，须为正斜线分隔的相对路径，拒绝绝对路径、反斜线、冒号、控制字符及空、`.`、`..` 路径段。

同车辆的来源路径唯一。上传事务锁定车辆，同时校验原件版本和车辆业务版本；幂等摘要包含文件实际 SHA、名称、类型、来源路径和类别。同键不同请求、重复路径或版本冲突必须拒绝，不能静默覆盖。新增原件、关联、独立版本递增、审计和幂等回执原子提交；车辆业务 revision、状态、里程及公开相册不因归档改变。原件不能借用通用后台、客户、公网媒体或其他业务附件入口读取。Nginx 仅对该原件上传路径放宽请求体至34m，其他API保持既有上限。

**车辆工作台资料分类、照片及查验（2026-11-03）**

后台权证页仅展示登记证、行驶证、采购合同、发票；保险和BaaS原件在对应页。历史 `PURCHASE/PAYMENT/INSPECTION/PHOTO/OTHER` 进入独立“待分类资料”页，显式归类后更新各页。旧 `INSPECTION` 是年检资料，旧 `PHOTO` 是私密图片原件，不自动转为第三方检测或公开车辆照片。分类不删除原件。

- `GET/POST/PATCH /admin/vehicles/:vehicleId/photos`：读取、单张上传、更新本车共用图库。GET/写入返回 `{vehicleId,vehicleRevision,coverFileId,mediaFileIds,items}`，items含 `{id,name,mimeType,size,sha256,url}`，url为后台鉴权预览。POST multipart含 `file/revision/idempotencyKey`；JPEG/PNG每张0–10MiB（不含0），总计20张；原无封面时首张自动设封面。PATCH含 `{revision,idempotencyKey,coverFileId,mediaFileIds}`，只能选择本车已绑定图片，封面为图库内ID或null；支持排序和移除绑定。保留车辆CAS、占用守卫、事务幂等，批量前端逐张消费新版本；同车商品复用既有车辆图库。
- `GET/POST /admin/vehicles/:vehicleId/inspections`、`PATCH /:inspectionId`：本车多条私密查验记录。内容 `{revision,idempotencyKey,title,provider,inspectedAt,description,imageFileIds}`，创建revision=0，编辑用记录自身版本；可空机构/日期显式null，日期严格YYYY-MM-DD，正文最多10000字、图片最多20张，正文与图片至少一项非空。记录版本独立于车辆业务版本。
- `GET/POST /admin/vehicles/:vehicleId/inspection-files`、`GET /:fileId`：同车专用检测图片列表、上传和私密预览。POST multipart含 `file/idempotencyKey`，JPEG/PNG 0–10MiB（不含0）；上传不自动加入报告。本车专用绑定与SHA校验，管理员/运营可读取，`private,no-store`；通用文件、公网媒体、其他业务引用均拒绝其用途或专用绑定，即使purpose被误改。
- 上述工作台接口仅当前有效ADMIN/OPERATIONS；写入还需 `vehicles.write`。图片/原件只按明确业务入口使用，不因通用车辆读取权限开放。
- `PATCH /admin/goods/:id` 增加 `inspectionSelections:[{id,revision}]`（0–20条、同车、去重），省略保留、空数组清空。商品CAS/幂等事务内核对源报告版本，冻结有序文字/图片摘要到独立 `inspectionSnapshots`；不改产品价格及条款来源。返回选择和快照。源报告编辑不自动更新已展示商品，每个商品独立选择并重新保存。
- `GET /public/vehicles/:id` 的每个 `plans[i].inspections` 输出该商品已选冻结报告 `{id,title,provider,inspectedAt,description,images}`；不合并同车全部报告。`GET /public/goods/:listingId/inspection-images/:fileId` 每次核对商品已发布且可见、车辆已发布、套餐启用、产品版本/来源有效、本商品快照文件与同车摘要；取消选择/隐藏/下架立即404。原 `conditionDisclosure` 及上架要求保持。
- 增量迁移 `202611030003_vehicle_workspace_media_inspections` 新建 `VehicleInspection/VehicleInspectionFile`、增加商品快照默认空数组及两类原件分类；不改历史车辆字段、原件内容或公开选择。

套餐字段：`vehicleId,name,months,monthlyFeeAmount,mileagePerMonthKm,excessMileagePriceAmount,energyDescription,benefits:string[],conditions,active`。

动作接口均 POST：

- `/vehicles/:id/publish`、`/unpublish`；`/plans/:id/activate`、`/deactivate`。
- `/applications/:id/review {decision:'IN_REVIEW'|'NEEDS_INFO'|'REJECTED',note}`。
- `/applications/:id/final-plan {revision,creditVerificationId,monthlyFeeAmount,months,mileagePerMonthKm,excessMileagePriceAmount,energyDescription,benefits,conditions,startDate,firstDueDate,commercialTerms,productSourceHash?}`；服务端按当前有效信用档位计算depositAmount，若兼容传入该金额则须严格一致。生成新revision和commercialHash，绑定核验ID、规则、档位与信用版本。传入 `productSourceHash` 时须与事务内重新读取的产品快照摘要一致，产品来源变化返回409，不能以已过期默认值生成方案。
- `/contracts/:id/send`、`/sync`；`/bills/:id/publish`；`/payments/:id/sync`。

### 合同账单自动发布（2026-10-29）

`SUBSCRIPTION` 与 `DEPOSIT` 草稿由系统在到期日前3个日历日自动发布，采用北京时间，自当日00:00进入窗口，每分钟扫描并在重启或合同晚归档后补发。`BILL_AUTO_PUBLISH_ENABLED=true` 显式启用；未启用不会扫描。自动发布不调用支付渠道，客户仍主动支付。附加费用等其他账单沿用原专项审核/发布流程。

后台 `GET /api/admin/bills`、`GET /api/admin/bills/:id` 和内部员工订单工作区 `billing[]` 增加只读 `publication`：`mode: AUTOMATIC|MANUAL`、`scheduledDate: YYYY-MM-DD|null`、`state: SCHEDULED|WAITING|BLOCKED|PUBLISHED|CLOSED|MANUAL`、`message`（中文说明）、`blockers: string[]`。客户与合作商聚合不返回内部发布投影，草稿仍不向客户展示。读取不得修改订单版本。

自动账单不再通过 `POST /api/admin/bills/:id/publish` 发布，该路径在RBAC校验后返回409 `BILL_AUTO_PUBLICATION_MANAGED`。系统在同订单锁内重读并复核归属、合同归档/有效版本及反馈、订单变更资金安排、实物收车与正式还车后未履约月份保护，排除已取消/已完成订单；仅 DRAFT 且未付款、正整数分的账单可变为 PENDING。每次成功转换原子写入唯一对应 `SYSTEM / billing-scheduler / AUTO_PUBLISH` 审计和站内待支付通知，重复扫描不重复发送。

自动发布任务预期业务阻断留待下次重试；单条错误不阻止其他订单，扫描使用主键游标避免首批阻断造成遗漏。发布开关需在生产切版保全校验完成后独立开启，启用前后的自动业务变化单独记录。
- `/refunds {paymentId,amount,reason}` 建立审核请求；`/refunds/:id/approve`、`/reject {reason}`。
- `/handovers {orderId,type,readingKm,fileIds,checklist}`；`/handovers/:id/publish`、`/complete`。
- `/mileages/:id/review {decision:'APPROVED'|'REJECTED',note}`。
- `/services/:id/assign {assigneeId?,providerName,contact,note}`；`/services/:id/status {status,note}`。
- `/legal-documents/:id/publish` 要求已记录用户正式文案确认；先只保存草稿。
- `/files` multipart 上传；`/files/:id` 授权读取。

`GET /admin/applications/:id/final-plan-defaults` 为待审方案提供默认值，仅供有方案办理权限的后台人员读取。返回 `{applicationId,revision,source:{productId,productVersionId,version,name,hash},values:{monthlyFeeAmount,months,mileagePerMonthKm,excessMileagePriceAmount,energyDescription,benefits,conditions,commercialTerms,productSourceHash},missingFields:string[]}`。产品字段来自本申请关联的有效已发布产品版本；金额保持整数分。14项默认条款不表示已签署，不产生业务写入；车况仅引用现场查验与交接证据，不虚构读数或完好结论。真实资料缺失应人工补充。

后台加载接口成功后初始化表单：已有候选方案与已保存人工条款优先于默认文本，空缺项再使用默认值；编辑中的输入不受后台回读覆盖。每项条款可人工修改或单独恢复默认。提交继续使用现有风险审核、版本校验和幂等机制，最终合同以本单冻结条款为准，不随产品或默认文案后续更新自动变化。

后台默认角色 ADMIN、OPERATIONS、FINANCE、SUPPORT；关键动作权限在服务端强制执行。前端可依据服务端 `permissions:string[]` 隐藏动作。

## 本申请的人工信用核验

`GET /customer/applications/:id/credit-review` 与 `GET /admin/applications/:id/credit-review` 返回申请级safe状态。客户限本人；后台信用读取及录入仅ADMIN/OPERATIONS。FINANCE/SUPPORT的普通申请/订单响应移除信用档位、核验ID、规则与信用版本，保留业务所需押金金额。

客户独立操作：

- `POST /customer/applications/:id/credit-consent {documentId,version,decision:'ACCEPT'|'DECLINE',idempotencyKey}`。ACCEPT要求当前terms/privacy已同意，并绑定当前已发布credit-verification文案；一般同意不能替代本申请的明确选择。
- `POST /customer/applications/:id/credit-consent/withdraw {consentId,idempotencyKey}`。撤回后不能继续核验或确认未成立方案；历史已确认订单不被改写。
- `POST /admin/applications/:id/credit-verifications {consentId,creditRevision,band,customerPresented:true,idempotencyKey}`。band只能为GE750/B700_749/B650_699/LT650/UNVERIFIABLE。核验人与时间取服务端，不接受精确分数、图片、自由证据备注或客户端指定操作人。

safe包含current document、申请独立consent、最新verification、creditRevision、ruleVersion、status，以及 `canConsent/canDecline/canWithdraw/canVerify/canFinalize/consentRequirementsMet/verificationCurrent/canConfirmFinalPlan/depositMultiplier`。客户确认使用canConfirmFinalPlan和方案绑定快照，不能误用后台canFinalize。

核验历史追加保存；新核验或授权变化使尚未确认方案回到审核并更新版本，旧版本确认被拒绝。前三档月费倍数为0/1/2，后两档转人工并禁止最终方案。后台可读状态不等于已获客户授权。

## 指定申请的真实订单验收报价

`POST /admin/applications/:id/final-plan` 可选 `pricingMode: STANDARD | V1_ONE_FEN | V2_ONE_YUAN`，默认 STANDARD。仅匹配服务器 `ORDER_ACCEPTANCE_SCOPE_JSON` 的申请、客户、车辆、日期及报价模式允许 ADMIN 选择验收报价；仍须有效的本申请信用授权与核验。V1_ONE_FEN 限定12期各1分和一次1分押金；V2_ONE_YUAN 限定12期各100分和一次100分押金，不改变信用档位或其他公开商品。配置未填 `pricingMode` 时保留历史 V1 行为及摘要兼容。服务器生成包含对应 `ruleVersion` 的 `acceptancePricing` 快照并纳入方案摘要，禁止客户端提交该字段。

管理员信用核验视图对匹配申请增加 `acceptancePricing` 报价提示；其他角色无该选项。客户方案返回 `pricingMode` 与 `pricingDescription`。确认前复核配置和信用版本；已确认订单的重复请求返回原订单，随后关闭配置不改写历史价格。财务/客服不能读取快照中的 `standardDepositAmount`。配置说明见 `controlled-order-pricing.md`。

## 指定客户的 0.01 元支付验收

与 `Bill/Payment/Order` 分离，不改变正式报价，不创建订阅或合同。服务端固定 `amount=1`、`currency=CNY`，默认关闭独立开关。创建授权后24小时内可发起；已在渠道处理中即使过期仍须查询或关单，不自动重新建单。

| 方法 | 路径 | 输入/返回 |
|---|---|---|
| POST | /admin/payment-verifications | 仅ADMIN；`{customerId,authorizationNote}` → safe记录 |
| GET | /admin/payment-verifications | 仅ADMIN；分页 `{items,total,page,pageSize}` |
| GET | /admin/payment-verifications/:id | 仅ADMIN；safe详情，含 `canClose` |
| POST | /admin/payment-verifications/:id/close | 仅ADMIN；查询并按可信渠道结果关闭未付单 → safe记录 |
| GET | /customer/payment-verifications | 仅当前客户；`{items}` |
| POST | /customer/payment-verifications/:id/pay | 当前客户、OpenID、当前协议同意；返回 `{verification,paymentParams}` |
| POST | /customer/payment-verifications/:id/query | 当前客户；可信渠道查询 → safe记录 |
| POST | /callbacks/wechat-pay-verification | 独立验签回调，已登记交易号/1分/CNY及商户应用核验后原子落账 |

safe记录至少含 `{id,amount,currency,status,expiresAt,createdAt,paidAt,canPay,canClose,title,manualReviewRequired,statusMessage}`；状态为 `AUTHORIZED/CREATING/PENDING/SUCCEEDED/CLOSED/FAILED/EXPIRED`。不返回OpenID、预支付ID或供应商原始响应。`paymentParams` 只通过本人已授权发起请求即时返回，客户端不持久化、不写日志。

客户同一时刻不能有第二笔非终态授权，已成功验收后禁止再次授权收费。发起遇可信渠道已终态返回409，客户端再query刷新；未知结果保留同一交易号查询。仅 `SUCCEEDED` 表示服务端已核实到账，客户端微信success不足以记账。退款不在此验收接口中执行。

已开始但渠道始终查不到的记录，只能由ADMIN在原授权到期10分钟后、无活跃请求租约且取得新的可信签名无单查询后结束为EXPIRED。此情况提示人工核对，不表示确定未扣款，保留原交易号并禁止同客户再次授权；迟到的可信成功仍可记账。短时无单、网络超时或验签失败不得据此结束记录。关闭写入校验对应租约，旧请求不能覆盖新的处理或已成功结果。

## 实现协调

API 实现人员负责把以上入口细化为 DTO、Prisma 实体与共享类型；新增必要字段写入本文并及时通知两个前端。支付和签署的具体 Gateway TypeScript 接口由 API 任务先定义，主控集成时适配接口，不以 placeholder success 代替第三方能力。
# 交还地点建议（2026-10-17）

`GET /public/handover-location`返回`enabled/mapEnabled/notice/policyHash`；notice只在当前已发布且与配置精确匹配时返回。配置规则见`docs/handover-location.md`。

申请提交及`POST /customer/applications/:id/amend`的profile可含可空的handoverLocation：

- 手填：`{source:"MANUAL",name:"地点名称（可为空）",address:"完整地址"}`。
- 地图：`{source:"MAP",name,address,accepted:true,policyHash:"本次展示的能力摘要"}`。
- name最多100字，address为2–500字；结构严格，不接收坐标、客户端同意时间或额外字段。地图需开关开启、当前文案摘要一致和独立同意。
- 服务器生成`consent:{customerId,documentId,version,contentHash,policyHash,acceptedAt}`。不把地图同意写成普通登录同意，也不由后台代客户勾选。
- 补件省略字段保留已有地点，null清除。仅当前客户、NEEDS_INFO状态允许新补件，幂等回放保留原结果。新增地点须当前隐私政策同意；清除不受此限制。
- 当前个人资料profile采用上文的严格版本化字段与三个证件槽，申请中的profile仅携带操作所需信息，可信资料由服务端读取并冻结，防止通过扩展字段保存坐标。个人资料接口不承担交接建议存储。

## 企业车主签约（OWNER）

> 历史ESIGN实现/兼容参照，不是v2.2合作商开通路径。v2.2不再要求邀请绑定Customer；合作商H5只读策略生效后，以下历史H5业务写能力不得通过旧链接/旧会话绕过。原签署任务、PDF、供应商回调及受控后台事实核验保留，不因新查看手机号自动迁移授权。

- `OWNER_ONBOARDING_ENABLED`、`OWNER_CONTRACTS_ENABLED`、`OWNER_MANUAL_CONTRACTS_ENABLED`、`OWNER_AUTO_SIGNING_ENABLED` 独立控制新操作，默认 false。实际车主的双方手签可由手动专用开关开放，自动执行仍要求原全局签署及自动开关；法人H5查询不触发自动签章。旧技术验收与已归档文件不迁入车主任务。
- ADMIN/OPERATIONS 通过 `/admin/vehicle-owners` 建档、生成7天手机号绑定邀请、更新联系号码和审核车辆归属。新企业邀请码固定24个 Base64URL 字符（18字节安全随机数），历史43位继续兼容；仅接受这两种精确长度。邀请原文仅创建时返回；存储 token/手机号摘要，不授予登录或用印权限。与登录用六位短信验证码分开，短信验证码模板不承载邀请码。
- 本人通过 `/customer/owners/claim` 接受邀请。`/:id/verification` 要求当前用户协议、隐私政策及 owner-identity 的主动同意；`/:id/refresh` 只以企业名称、信用代码、认证经办人手机号、当前证书和印章渠道证据更新就绪状态。选用印章须本人操作。
- `/:id/authorities` 创建冻结授权范围。v1保留车辆、模板ID/版本/摘要、有效期、月租/押金和期数边界；新增v2仅包括授权起止期间、服务端可信被授权主体及文件种类，本期为 `SUBSCRIPTION_WITH_FEES`（主合同及同份PDF费用附件）。`OWNER_AUTHORIZATION_SCOPE_VERSION` 默认1；配置2且新版授权说明发布后才接受v2新申请，旧v1不迁移或扩权。新范围取消产品参数限制，但逐单归属、实际出租方、批准模板、交易条件、PDF及审核仍须核验。渠道授权成功后仍默认关闭；本人 `switch` 开启，运营只能暂停。关闭本地开关不谎称撤销渠道授权；每次自动执行前重新查询授权和身份，未知结果不重发。详细H5契约见 [法人H5接口](api-owner-h5.md)。
- 最终方案冻结 `lessorSnapshot` 及解析后的信息提供告知。客户确认时须单独提交 `{accepted:true,lessorHash,noticeHash}`；身份、车辆归属或告知变化要求重出方案。车主绑定车辆不会降级成晓浪出租。
- 主合同和补充协议生成 OWNER/CUSTOMER 两方任务及独立交易。运营在 `/admin/vehicle-owners/:id/contracts/:contractId/prepare` 生成文件，在 `/tasks/:taskId/review` 核对完整PDF与摘要；此操作不代替企业授权或本人签署。
- 未上传、双方均未尝试签署且无处理中请求的准备文件，在企业更换印章或证书后可再次 prepare；系统保留原文和审计映射，换发任务及交易编号并清除复核。已进入渠道的文件只能核验原交易，不能改绑身份。撤销任一历史授权会先原子关闭该企业账号的全部本地授权，再进入渠道撤销页。
- 经核验的当前企业经办人才能读取 `/customer/owners/:id/contracts/:taskId` 及其 `files/source|signed`。逐份签署需 accepted、documentHash、sourceSha256，不能传供应商身份或印章编号。手动选择与自动执行持久化意图互斥；在途不重签。
- 延期及同一车主的换车补充协议仅支持逐份手动签署。目标车归属审核固定在报价中，变化要求重新确认；更换出租方不可套用同一合同。交接单列明实际出租方，宁达环境由上海宁达信息科技有限公司作为交接作业方与客户确认事实，不以电子签 API 应用所属企业代替实际作业主体。
- 查询绑定原合同、原交易和原签署账号。双方签署证据与签后PDF校验齐备后才归档并推进原订单/变更。供应商失败状态保留原任务并停止后续用印；回跳事件不作为签署证据。
- 企业客户、印章、授权和任务表位于本项目独立库；不访问旧系统业务库。平台清分/车主结算不在本版实现范围。

## 宁达交接单逐份手签（2026-10-25）

> 历史ESIGN实现参照。下述H5 sign/sync不是v2.2只读白名单；v2.2目标关闭外部H5业务写入，保留原任务/文件和独立回调事实，不恢复新电子签。

- 新建 HANDOVER 任务在 `HANDOVER_PLATFORM_SIGNING_MODE=MANUAL` 时冻结平台手签模式；历史任务保持原模式，不能通过环境变量变更静默转换。新交接签署仍需 `FADADA_SIGNING_ENABLED=true`、有效交接策略及按同份 PDF 完成的双人审批。
- 客户先签署，宁达当前已核验法人再从服务号“业务合同”进入同份交接单，阅读并确认后逐份手签。查询和回调只核验、归档手动任务，不能派发自动盖章；原 `OWNER_AUTO_SIGNING_ENABLED` 和技术验收签署开关独立保持关闭。
- 新 `/owner-h5/owners/:ownerId/handovers` 系列接口提供列表、详情、受保护 PDF、本人签署和同步。任务使用 `FadadaTask`，通过 `documentDomain=PLATFORM_HANDOVER` 与实际出租方的 `OwnerSigningTask` 区分。详细契约见 [法人 H5 接口](api-owner-h5.md)。
- 既有平台印章档案启用、个人申请/复核权限不代替法人签署。只有可信双方结果与签后 PDF 校验完成才推进交接签署状态；实际交车或还车完成仍走原业务条件。

## 后台统一订单办理进度（2026-10-29）

- `GET /admin/orders/:id/workspace` 对线下签约订单的后台岗位增加 `process`，保留原工作区字段；客户和合作商接口不增加该后台投影。
- `process` 包含 `version:1, orderId, orderRevision, observedAt, currentStep, terminal, steps, blockers, attention, primaryAction, related`。七个主节点依次为 `APPLICATION/CONTRACT/PAYMENT/DELIVERY/IN_USE/RETURN/SETTLEMENT`；取消作为终止结果，不把未履约节点标成完成。
- 节点与检查项采用 `DONE/CURRENT/BLOCKED/WAITING/NOT_APPLICABLE/UNKNOWN`，返回中文说明、办理岗位及有权限的下一步动作。动作限定资源、记录和本单编号，不承载任意命令或任意跳转 URL。`related` 仅包括该岗位有权读取的本单档案、账单及原支付退款链、现场任务、交接记录和还车结算。
- 后台工作区在只读一致性事务中读取。查看进度不修改订单、账单、任务、档案或版本，不调用付款、退款、签署渠道。读取失败时前端保留上下文并禁用依赖当前状态的提交。
- `POST /admin/orders/:id/recheck-delivery` 接收 `{revision,idempotencyKey}`。仅当前有订单写权限的工作人员可对 `OFFLINE + AWAITING_PAYMENT` 订单显式重核；服务端锁定本单，校验版本和幂等后复用现有合同、首期净有效到账、押金、车辆及业务资料条件。全部满足才转待交付并增加版本与审计；未满足返回 `409 DELIVERY_NOT_READY` 和具体检查项。该接口不代付款、不忽略退款，也不代替实际交车。
- 1 分 `PAYMENT_TEST` 账单仅展示支付链路结果，不抵首期租金。已退款金额独立显示；自动发布账单沿用服务端的发布时间和暂缓原因，不由浏览器推算或发布。
- 本单页面可就地打开既有合同归档、任务、交接、资金及结算办理表单；各原接口的权限、版本、独立复核、客户本人确认与实际现场采集规则继续执行。

## 后台交付前取消工作区（2026-10-30）

- `GET /admin/orders/:id/cancellation-readiness` 仅供当前有效且有订单读取权限的管理员、运营、财务使用，限线下签约订单。使用 `READ ONLY + RepeatableRead` 事务；查询不调用资金或签署渠道，不新增审计、通知，也不修改任何业务记录。
- 返回 `version:1, orderId, orderRevision, orderStatus, observedAt, mode, canCancel, currentStep, steps, blockers, attention, actions, related, effects`。`mode` 为 `PRE_DELIVERY_CANCEL / POST_DELIVERY_RETURN / TERMINAL`；步骤为 `EVIDENCE / TERMINATION / FUNDS / CONFIRM / RESULT`。步骤按前序条件串联，只有当前步骤可写入，全部真实条件满足后方可确认取消。
- `related` 仅关联本单的当前取消核实、终止档案、账单及原支付退款、现场任务和未结束变更。财务不取得取消证据或私有档案内容；动作返回目标资源、记录、本单编号、对应 `expectedRevision`、是否可办及禁用原因，不接受任意 URL 或命令。
- 就绪查询和 `POST /admin/orders/:id/cancel` 共用取消条件。最终命令仍在事务内锁定订单，重新核对当前人员权限、订单版本、纸质签署核实、有效终止文件、条款与反馈、变更及历史签署任务、车辆预留、在途支付退款和逐笔全退，并按原幂等约定落库。
- 取消依据使用取消核实版本；终止档案使用档案版本；最终取消使用订单版本，三者不可混用。取消签署核实由运营直接办理，历史租赁签字版可证明已签；线下档案可同人审核后明确归档。真实退款仍执行原有申请/审批分权及渠道结果校验。
- 已签未交付订单可从本单取消分支建立或打开 `TERMINATION` 档案。无实收款无需先付款；退款审批通过不等于退款渠道成功。现场任务只作核对提示，不新增“全部撤销任务”取消门槛，也不随取消隐式撤销。
- 准备取消不冻结支付、交付或自动发账，也不新增中间订单状态。最终取消成功才使未结束账单作废、权益失效、未完成交接成为历史版本、车辆解除预留并转未上架；历史合同及收退款保留。已交付订单指向还车结算。

## 现场交接（FIELD）

- `FIELD` 账号仅可使用本人 `/admin/auth/me|password|logout` 及 `/admin/field-tasks`，不能读取普通后台资源或通用文件。仍使用 HttpOnly cookie、Origin 和 CSRF 校验。
- ADMIN/OPERATIONS：`GET/POST /admin/handover-tasks`，`GET /:id`，`GET /assignees`；`POST /:id/reassign|cancel|restart`。创建 `{orderId,type:DELIVERY|RETURN,assigneeId,note}`；变更须当前 `version`；重新启用还需 `reset:true` 与人员、原因，只允许未发布且已取消/车辆批次变化的任务。
- FIELD：`GET /admin/field-tasks` 及 `/:id` 仅本人未取消任务。返回最小客户称呼、任务车辆、已确认交还安排、草稿、附件及交接阶段，不返回完整客户/订单/财务资料。
- `POST /:id/draft`：`{version,draft:{actualAt,readingKm,batteryPercent,place,accessories,condition,openItems,resolutionPlan,resolutionNote,fileIds}}`。草稿允许空字段；发布须完整。人员姓名由服务端确定。
- `POST /:id/files`：multipart `file` + `version`，单份10MiB/每草稿20份，JPEG/PNG/PDF，返回 `{id,name,mimeType,size,task}`；上传后版本递增并加入草稿。`GET /:id/files/:fileId` 每次校验本人任务及当前材料批次；改派、重启或取消使旧权限失效。
- `POST /:id/publish`：`{version,idempotencyKey,checked:true}`。事务核对员工、车辆/assignment 快照、附件批次、订单状态、时间和里程。同编号同版本重试不重复发布。创建现有 Handover 并通知客户；异议新建修订版，已确认不可修改。
- 客户继续 `/customer/handovers/:id` 及 `confirm|object|sign|sign-status`。中文清单 `label` 是显示投影，`factKey` 保留原键，数据库事实和 `manifestHash` 不变。最终完成仍使用原后台交接动作及原付款、签署、归档就绪条件。
- `GET /customer/handovers/:id` 新增只读 `signingReadiness`：`{version:1,handoverId,manifestHash,revision,stage,canSign,message}`。状态绑定当前交接单、证据哈希和修订号；`stage` 为 `FACTS_PENDING|PREPARING|REVIEWING|READY_TO_SIGN|VERIFYING|WAITING_PLATFORM|ARCHIVING|SIGNED|REJECTED|EXPIRED|BLOCKED`。仅 `READY_TO_SIGN` 且 `canSign===true` 可展示可用签署操作；缺失、未知或版本绑定不匹配时保守关闭。已确认事实但尚无复核申请为 `PREPARING`，有当前待审批申请为 `REVIEWING`。
- 签署状态读取不生成文档/审批/任务、不调用签署供应商或推进业务状态，不返回审批人员、供应商身份及内部用印权限。实际发起签署仍执行既有服务器实时守卫；读取时的可用状态不构成签署授权。客户阅读勾选与提交事实意见、后台双人复核、本人独立签署分别处理。
- 任务绑定车辆与交付批次；变化后草稿锁定，未发布任务经后台明确重启并清空采集，历史草稿/材料保留审计，旧文件不能注入新的材料批次。后台接管已发布交接修订后，现场工作台停止编辑该历史版本。

## 试运行线下合同串联及终止明细（2026-10-30）

本节覆盖旧线下档案双人复核/原件保管必填以及审核即归档的描述，旧ESIGN及非协议业务规则不变。实施与上线结果见本次发布记录，操作说明见 [合同与取消指引](operations/ninda-contract-trial-flow.md)。

- `POST /admin/legal-documents/:id/activate`：`{confirmed:true,expectedVersion,expectedContentHash,idempotencyKey}`。ADMIN/OPERATIONS核对草稿正文后启用，同类型原有效版本转RETIRED；基于类型事务锁、内容指纹及幂等。旧`publish`路径执行同一严格校验，不可绕过。已绑定合同固定模板版本，允许重印已停用的绑定模板。
- `POST /admin/offline-archives/:id/versions/:versionId/confirm-print`：`{revision,idempotencyKey}`，只确认本版当前已生成源文件。新DRAFT上传及提交前须生成并确认；重生成或改动影响正文的资料使确认失效。
- `review APPROVE`进入`REVIEWED`（待归档），同一有权限运营可上传、提交和审核，不要求保管人、位置或保管确认。签字方、页数、附件归属、完整性和条款核验保留。
- `POST /admin/offline-archives/:id/archive`：`{versionId,revision,idempotencyKey}`，仅最新REVIEWED版本可归档，重新核对权限、快照、附件和审核结果。仅归档产生原合同放行副作用；旧SUBMITTED和ARCHIVED兼容但不自动审批。
- 版本detail增加`printConfirmed`；历史及INVALIDATED版本反馈可以按权限解决，但正文、附件及历史归档不可原地编辑。REVIEWED可创建补正版本，旧版不得越过更新版本归档。
- TERMINATION的metadata支持`terminationDetails`，存入版本scopeSnapshot；包括`reasonType/reason/effectiveAt/plannedReturnAt?/returnPlace?/conditionSummary/violationStatus/violationSummary/additionalPaymentAmount/additionalPaymentDueOn?/refundAmount/refundDueOn?/retainedDepositAmount/retainedDepositHandling/settlementBasis/unresolvedMatters`。金额为非负整数分，非零补退金额须ISO日期；待处理违章及保留款须具体期限。修改后重新生成确认。
- TERMINATION detail提供本单`terminationContext`，按实际签署租赁版本读取原合同名称、编号和原冻结终止/押金条款，附车辆交付/接收及可信收退款参考。原资料缺失明确blocker；不借当前产品或新模板替换。专用打印不附整套订阅方案、14项或权益全文。
- 取消readiness增加`signing.paperStatus/source`，source为`ARCHIVE/CONFIRMATION/UNCONFIRMED`。新签署核实直接保存有效确认，附件选填；旧SUBMITTED可同人确认，已签事实、未知/冲突及资金守卫继续阻断不符合条件的取消。
终止打印另冻结`scopeSnapshot.terminationPrintSnapshot={context,sourceFactHash,capturedAt}`，sourceFactHash按递归稳定键序计算，不含后续收退款参考。原签合同、VIN、交接事实发生变化时，确认/上传/提交/审核/归档须重新核对并重生成或补正，不能用实时资料暗换签署内容；JSONB回读键序变化不应造成误冲突。交付待核实为`UNKNOWN`并明确阻断，订单待交车状态为`AWAITING_HANDOVER`。

`POST /admin/offline-archives/:id/versions`新增可选`supersedeDraftVersionId`：仅显式匹配唯一最新DRAFT、无其他未完成候选并满足revision时，事务内保留旧文件并把旧草稿标为`SUPERSEDED`，建立新DRAFT。该状态不是审核通过或已签事实，不向客户开放草稿附件。已有签字原件的DRAFT不再允许直接改打印正文或重新生成；须通过该补正路径重新签署上传。没有原件时仍可返回修改、生成和确认。历史SUBMITTED终止缺少打印来源快照的，须先退回材料再补正，不补造过去的确认记录。
# 2026-11-01 验收修复增量（后台已发布，客户端 1.2.1 已上传）

API、PC 与现场端已发布 `20261101-acceptance-v1`，64 条迁移记录及线上健康、静态文件检查通过。`ONLINE_HANDOVER_TERMS` v1 已按用户批准的原文启用。小程序 1.2.1 已上传开发版本，用户已确认设为体验版，并随后授权提交 1.2.1 生产发布；本次自动操作因浏览器网址识别失败被桌面工具停止，待人工在微信版本管理提交审核，未取得提审或发布成功回执。发布与只读验收证据位于 `.runtime/ninda/acceptance-20261101/`。

- 普通资料审核采用岗位规则：ADMIN可审核本人经办资料，仍留操作者/来源审计；其他岗位保留资源权限及独立审核约束。退款、收支核对、费用/改价、分润与收款账户、企业印章授权的双人约束不变。
- 线下合同草稿可补齐冻结主体缺失法定信息：个人姓名/身份证号/电话，企业名称/统一社会信用代码。实体归属、角色、姓名类型及已有非空法定字段不可在补齐接口改写；提交须有核对说明。改动会清除生成件引用，必须重新生成并确认打印；已上传签字版拒绝改写。个人合作档案原件仅既有本人归属及ADMIN/OPERATIONS可读，其他工作人员仅摘要。历史归档不回写。
- 客户账单记录保持资源 `type:'bills'`，新增 `billType`；订单 workspace.billing 保持 `type` 为具体账单类型。二者都返回实际 `description` 及 `period:{sequence,startDate,endDate,basis}` 或null。日期取已存服务月/冻结义务，起租前仅保留实际租金期数并以 `PENDING_HANDOVER` 标记，不使用应付日期推算服务月。金额及付款能力不变。
- 后台订单流程PAYMENT仅描述资金核清事实；资金已核清后的当前办理阶段为DELIVERY，真实订单status仍须原有重新核对命令通过全部条件才流转。已交付阶段保留完成，后续资金异常单独提示。
- 新增 LegalDocument.type `ONLINE_HANDOVER_TERMS`，本次v1正文已经用户批准；正式发布必须携带真实确认人/时间再激活。新OFFLINE四类交接使用 `confirmationMode:'ONLINE_RECORD'`；历史默认 `SEPARATE_DOCUMENT` 不迁移确认事实。
- ONLINE_RECORD冻结 `onlineRecordSnapshot`（约定documentId/termsVersion/termsHash/正文，主体、车辆、实际时间/里程/检查清单及附件ID/SHA256/大小），manifestHash绑定该版本。客户端确认须提交revision/manifestHash/readFileIds/documentId/termsVersion/termsHash/termsAccepted，并通过本人归属、当前版本、附件获取记录及实际文件摘要核对；异议修订重新确认。重复命令幂等。
- `signingReadiness.version:3,confirmationMode:'ONLINE_RECORD',canSign:false`，stage为FACTS_PENDING/WAITING_COMPLETION/RECORDED/OBJECTION_SUBMITTED/SUPERSEDED/BLOCKED；`onlineRecord`为本人或授权运营可读的冻结记录。客户确认和后台实际完成分别保存，线上交接不产生电子签章成功事实。
- 线上快照仅保存交接所需的主体与车辆摘要，内部来源以 ID、版本及摘要绑定，不嵌入完整订单、报价、风控、分润或账户快照。客户 GET／确认／异议／幂等重放及现场端均使用嵌套字段白名单；历史快照的内部摘要不改写，对外仍按白名单投影。
- 线上交接只解除纸质交接单强制签署/归档门禁，主租赁/续期换车补充协议、资金/车辆/里程/实际完成及结算门禁继续有效。小程序生产发布仍暂停，旧体验包不具备新约定确认字段，必须使用更新体验包确认新线上交接。

### 2026-11-02 电子签重启（开发中，尚未切换生产）

- 统一三方／双方电子任务接口及回调约束见 [电子签接口](api/electronic-documents.md)。内部办理模式 `ELECTRONIC` 与旧双签 `ESIGN` 分开；交接不创建电子签任务。
- 逐方实名、证书、源文件、业务版本与渠道交易号不可改绑。客户→实际出租方→宁达；合作协议为实际出租方→宁达。仅全部签署经查询核验、渠道备案确认及最终 PDF 完整落库后形成电子归档证明。
- 新能力在完成业务接入、正式文本批准及渠道主体核验前保持关闭；本文不声明已上线。

## 车辆资料卡的打开与移除（2026-11-04）

以下接口位于 `/api` 下，复用车辆私密原件的当前有效 `ADMIN/OPERATIONS`、本车绑定与摘要校验；写入继续校验 `vehicles.write`、Origin、CSRF、会话 authVersion。

| 方法 | 路径 | 输入/返回 |
|---|---|---|
| GET | `/admin/vehicles/:vehicleId/documents/:fileId/open` | 鉴权打开当前仍在资料卡内的本车原件。PDF/JPEG/PNG/MP4 为 `inline`，DOCX 回退为 `attachment`；均保留准确 MIME、`private, no-store`、`nosniff`。不新建业务记录 |
| POST | `/admin/vehicles/:vehicleId/documents/:fileId/remove` | 严格 JSON `{revision,vehicleRevision,idempotencyKey}`；返回 `{removed:true,fileId,revision,vehicleRevision}`，其中 `revision` 递增 1，车辆业务版本不变 |

原 GET `/documents/:fileId` 的 `attachment` 行为保持。不得改用通用后台/客户文件路径或公开媒体地址绕开原件专属授权。已移除原件的列表、专属读取、打开及新的分类请求均不可访问。

移除在同一事务内执行车辆行锁、双版本 CAS、`removedAt/removedBy` 软标记、审计及幂等回执。相同键与完全相同输入重放原回执；同键变更参数返回 409。重复键重放在 active 检查前完成，已移除后的未知结果重试不会误变成新操作。版本冲突、跨车文件、已移除文件的新请求不得继续写入。

移除不删除 `VehicleDocumentFile`、`StoredFile` 或磁盘原件字节，不改车辆状态、里程、公开相册、保单或历史档案。所有通用文件和跨业务隐私边界仍统计已移除绑定，即使用途被误改也不得重新公开。增量迁移仅为原件绑定新增 nullable `removedAt/removedBy`，并要求移除时间与非空操作人同时存在或同时为空；原有摘要、来源路径唯一及外键约束保留。

拖拽上传继续复用原 POST multipart 契约，按卡片冻结 `category`。新的上传请求应使用独立命名空间的 `sourceRelativePath`（例如 `manual-uploads/<idempotencyKey>/<原相对文件名>`），允许移除后同名重传且不覆盖旧原件；未知结果重试必须保持原文件、类别、路径、双版本与幂等键，不自动重新生成请求。

## 单次保险登记及历史修正（2026-11-04）

- `POST /api/admin/insurance-policies/registrations` 创建；`POST /api/admin/insurance-policies/:id/registrations` 修改。使用 multipart，唯一文本字段 `input` 为严格 JSON，新增文件重复使用 `files` 字段。无需分开草稿、上传、提交、复核。
- input：`{revision,idempotencyKey,versionId,versionRevision,vehicleIds,policyType,policyNumber,insurer,insuredParty,startAt,endAt,fileIds?,policyholder?,premiumAmount?,reason?,confirmed:true}`。新建为 revision=0/versionId=null/versionRevision=0；修改为最新保单 revision 和最新 versionId/versionRevision，reason 2—1000 字必填。policyType 为 COMPULSORY_TRAFFIC/COMMERCIAL/DRIVER_PASSENGER/OTHER；历史未知类型保留 null。金额为整数分；未登记投保人留空，不复制被保险人。日期沿用北京时间日期、截止日包含当日，ISO 具体时刻截止不含。
- 保留附件通过本保单 fileIds 选择，新增原件直接成为本版本附件；合计1—20份、PDF/JPEG/PNG、单份<=10MiB、总计<=32MiB。实际字节 magic、大小与SHA256、当前人员、保单绑定及逐车附件归属均校验。同键更换输入、文件名或实际文件字节409；已提交同键请求在版本检查前重放原响应，失联后按原请求重试。
- 成功返回详情和当前投影：`vehicles:[{id,vin,plateNumber,title,revision}]`、`currentVersionId`、`currentStatus`、`policyType/startAt/endAt/insuredParty`。versions 保留全历史，附 `registeredByStaff:{id,name,username}|null`；files 附真实 `id/fileId,name,mimeType,size,sha256`，不返回存储路径。`GET /api/admin/insurance-policies` 在服务端对 search（保单号、机构、被保人、车牌、VIN、车型）、vehicleId、policyType、status、expiringWithinDays 筛选后分页，total 为全量匹配数。当前状态 NOT_STARTED/ACTIVE/EXPIRED/CANCELLED/DRAFT/SUBMITTED/REJECTED/UNVERIFIED 与原版本审核状态分开；旧按审核状态 APPROVED/REGISTERED 的筛选兼容。
- 新记录为 REGISTERED，冻结真实登记人、时间、车辆信息、原件ID及SHA256、输入机构/保单号和修改说明；旧 APPROVED 审核事实保留。保单号与机构修正创建新版本并更新根当前身份及唯一性，旧版本身份快照不改。REGISTERED 的 `effectiveAt` 为保存时刻，不冒充过去已审核；当前登记后未来旧审核版本也不得重新覆盖它。旧时间查询保留当时真实事实。
- REGISTERED 的 coverageItems=[]、terms=''、requirementVersionIds=[]，reviewedBy/reviewedAt/reviewChecks 不伪造。真实证据完整时只作为车辆当前保单基础存在依据；若调用方提供具体险种/额度要求，返回 INSURANCE_REQUIREMENTS_UNVERIFIED。coverage 与续保提醒均先选最新有效版本再核实登记证据，损坏新证据不能复活旧版本。
- 使用单次登记后，该保单旧的草稿/提交/审核/独立上传写入口拒绝并提示使用登记；既有同键成功命令仍按原约定重放。文件 `GET /api/admin/insurance-policies/:id/files/:fileId/open`（原 files/:fileId 亦可）继续按本保单专属授权 inline/private-no-store/nosniff 打开，不接受通用文件路由替代。
- 同事务保留当前有效人员 RBAC/Origin/CSRF、幂等 advisory lock、保单与排序车辆行锁、保单 CAS 与最新版本检查、附件绑定、历史版本、before/after 审计及幂等回执。失败不留下半份业务登记，也不物理删除任何历史原件。

## 车辆与商品发布前六项资料检查（2026-11-12 调整）

`GET /api/admin/vehicles/:id/publish-readiness` 仅当前有效 ADMIN/OPERATIONS；`GET /api/admin/goods/:id/publish-readiness` 按 goods.read 权限。两者只读，不建立业务成功记录，不向有限车辆读权限的 FINANCE/SUPPORT 泄漏保险、合作方或资产缺失细节。

返回 `{vehicleId,vehicleRevision,goodsId?,goodsRevision?,checkedAt,publicationDate,ready,checks}`。checkedAt 为本次真实 ISO 时刻，publicationDate 为对应上海日期；specific goods 须属于本次车辆，版本为实际当前读取值。checks 固定六项 `{key,label,passed,required,messages:string[],targetView}`：

| key | 判断 | targetView |
|---|---|---|
| VEHICLE_INFO | 必要车辆名称/品牌/车型、17位VIN、年份、真实非负里程、城市、明确电池归属 OWNED/BAAS；发动机号、详细描述等选填项不强制 | overview |
| PARTNER_INFO | 明确唯一实际候选或有效合作方，主体类型、名称、地址、联系电话齐备；企业有18位信用代码。资料门槛不冒充独立复核或租赁合作资格通过 | documents |
| PRODUCT | 本车存在真实匹配已发布产品版本的 DRAFT/PUBLISHED/WITHDRAWN 商品卡槽，关联套餐正确且冻结配置/源摘要有效；specific goods 只查本条，避免商品与车辆必须互相先发布 | listing |
| PHOTOS | 本车至少一张相册图及一个商品封面，可共用同一张。明确公开车辆用途/后台归属、图片 magic/摘要/实际字节有效，且通过公开 media 相同的历史私密绑定边界 | photos |
| BAAS | batteryOwnership=BAAS 时最新未归档/未终止合同基础资料完整，完整 DRAFT 可通过；不额外强制启用、付款、成本计划或附件。非BAAS为 required=false/passed=true | battery-baas |
| CONDITION | 真实基本车况判断记录明确 fireDamage/floodDamage/structuralDamage 三个 boolean；true 与 false 均合法，附实际登记人、时间和版本，不强制详细报告或无损声明 | inspection |

ready 严格等于所有 required 项 passed。messages 返回对应缺失原因，前端 ready 或未知字段不能解除发布约束。商品 publish 与车辆 publish 在原事务/当前人员/占用锁/版本和幂等命令中重新检查同一事实；不完整返回409 PUBLISH_REQUIREMENTS，error.readiness 为当时完整六项状态。撤销发布不新增这些前置条件。商品下架、修改、再发布仍沿用原稳定套餐引用及源校验。

040迁移仅为 VehicleListing 添加 nullable basicConditionSnapshot，不回填历史判断，也不改 inspectionSnapshots 原v1或其摘要。新发布冻结本车基本判断、来源版本、实际登记时间/人及独立摘要；车辆重新上架同时为当前已发布商品冻结本次真实判断并递增其版本。客户公开投影仅给三项 boolean/时间，绝不输出内部 assessedBy、完整快照或人员ID。恢复版小程序原有 report.items 的 label/value 路径直接显示“是否火烧/是否泡水/是否结构损伤”的真实是/否，兼容提供 title/description 别名，并在公开 conditionDisclosure 文字中包含三项事实；无须更改小程序源码。



## 独立里程包与目标换车权益（2026-11-05，开发增量）


仅 MILEAGE_PACK 与 SWAP_CREDIT。金额整数分。AddonProduct 根 revision 与 AddonProductVersion revision；版本状态 DRAFT/PUBLISHED/SUSPENDED/RETIRED。发布版本内容不可改；新发布退役本商品原售版本。新建版本不补价。

后台 ADMIN/OPERATIONS，resource=addon-products。GET /api/admin/addon-products?kind=&search=&page=&pageSize=；GET /:id 返回根及 versions。POST /addon-products 与 /:id/versions 输入 {kind,name,revision,idempotencyKey,scopePrices:[]}。PATCH /:id/versions/:versionId 同输入（revision 为版本revision）。scopePrices 每项 {id,scopes:[{brand,allModels,modelDefinitionIds:[]}],prices:[{km,amount}]}；SWAP_CREDIT prices=[{quantity:1,amount}]。每组 scope OR 匹配，只按真实 canonical brand+车型ID核验；allModels=true 时车型数组须空。MILEAGE_PACK 发布每组恰含1000/1500/2000三档且单位价严格递减。POST /:id/publish {versionId,revision,idempotencyKey}；POST /:id/versions/:versionId/suspend|resume|retire {revision,idempotencyKey,reason}。

GET /api/customer/orders/:id/addon-products?kind=MILEAGE_PACK|SWAP_CREDIT&targetModelDefinitionId=… 返回 {orderId,kind,eligible,blockers,context,terms,products,targetModels}。context 含 periodId/startDate/endDate/expiresAt/serviceStageId/assignmentId/modelDefinitionId；products 每个 {productId,name,versionId,version,sourceHash,quotes:[{quoteId,km?|quantity?,amount,currency:'CNY'}]}。SWAP_CREDIT 必须用户选择 targetModels 真实车型后才报价，品牌范围指希望换入目标车辆；金额不含车辆升级差价。重叠有效定价拒绝歧义报价。terms={version:'MILEAGE_PACK_V2'|'SWAP_CREDIT_ADDON_V1',hash,content} 为不可变功能说明，不替换历史合同或法律文档。

POST /api/customer/orders/:id/mileage-packs 新增严格V2输入 {productId,versionId,quoteId,sourceHash,periodId,termsVersion:'MILEAGE_PACK_V2',termsHash,accepted:true,idempotencyKey}。旧V1购买关闭，旧记录/结转/合同hash不改。POST /api/customer/orders/:id/swap-credits 新增 {sku:'SWAP_CREDIT_ADDON_1',productId,versionId,quoteId,sourceHash,targetModelDefinitionId,termsVersion:'SWAP_CREDIT_ADDON_V1',termsHash,accepted:true,idempotencyKey}。创建返回既有 purchase+bill。

本人真实 ACTIVE 服务段/当前 assignment/未收车/当期未结算；不授权未来段。月包仅下单时 UsagePeriod [start,end) 上海计费月有效，同月换车沿同订单同月余额，不跨月结转。V2原月待结算余额保留，当前可用和历史待结算分开投影；原月结算后一次EXPIRE剩余。渠道月内成功且原月尚未结算，允许晚通知归原月；月界后成功/已结算/已收车/失效来源时，真实钱记SUCCEEDED+reconciliation，零发放，复用异常全退链。pay前和渠道ready后重核。新换车SKU期限沿实际服务租期/退订，不跨订单/续期，沿赠送优先账本；预占和完成必须验证实际目标车型等于购买冻结目标并匹配冻结scope。

旧MILEAGE_PACK_V1与旧SWAP_CREDIT定价、赠送权益及法律hash保留；不新增渠道，不真实付款/签署，不引入补能商品。


### 资金边界与旧入口补充

- pay在渠道请求前和请求就绪后执行同一套账单、订单、纸档、实物收车、换车期限、订单变更、归还后月份及月包守卫。就绪后失效保留PENDING渠道请求与参数用于查询核账，不向客户返回失效支付参数，不假设未知支付从未扣款。
- 新V3换车可信到账遇实物收车或用量账户冻结，只形成PAYMENT_REVIEW的冻结凭据并标记reconciliation，无可用换车权益，保留完整例外退款链。
- 新V2月包/V3换车所有异常到账与第二笔额外到账，在是否授额之外独立进入资金核账；若原订单/归还结算已完成则转SETTLING/PENDING_PAYMENT。每个Payment首次可信成功转移只登记一次，重复通知不重发权益、不重开已结算费用。
- 旧SWAP_CREDIT_1/SWAP_CREDIT_TERM_1不接受新幂等键销售；当前会话和订单归属校验后，已有同键同内容购买仍回放，既有PENDING原账单仍可按原价格/期限付款、授额和退款。旧purchaseAccount.product与purchaseTerms仅历史投影，canPurchase=false，purchaseCatalogPath导向新目标权益目录。
- catalog.context补充真实当前modelName/brand；V3历史purchaseView可有targetModelName（当前车型名称只读显示，不改原目标ID/价格或快照）。


### 里程包真实资金投影

GET usage-account的packs每项保留原status（数据库状态），追加effectiveStatus、bill:{id,type,amount,paidAmount,status}、paymentReview:{required,reason,reasons,unresolvedReceiptCount}、paymentFacts:{receiptCount,receivedAmount,refundedAmount,netReceivedAmount,pendingRefundCount}、canPay。数据仅取该购买所属账单、本人可信SUCCEEDED付款与实际成功渠道退款；不回传支付/退款渠道身份或交易号。

无授额的原PENDING_PAYMENT/VOID购买实际到账未核清时effectiveStatus=PAYMENT_REVIEW（待退为REFUND_PENDING、实际全退为REFUNDED），即使数据库status仍PENDING_PAYMENT也必须展示已付款待核账并禁止再次付款。已有合法ACTIVE包遇第二笔异常到账时effectiveStatus仍ACTIVE，原额度可用事实不变，单独paymentReview提示额外款核账；额外款实际全退后不清除原合法额度。

usage-account增加availablePackBalanceKm，只汇总canUseNow=true的真实余额；必须正在履行、账户ACTIVE、未实物收车、有当前服务月，V2还必须为同period且未过expiresAt。旧packBalanceKm为账面投影，不能当作当期可用。原历史余额和待结算原月额度不清零。客户端recover GET须使用row.bill及effectiveStatus，不复用创建时缓存的PENDING账单，不因为月份已变重新POST。

### 车辆与 BaaS 列表筛选补充（2026-11-05）

- `GET /api/admin/vehicles` 保留原搜索、状态与分页，支持 `cooperationOwnerId`、`mileageKmMin/Max`、`ageMonthsMin/Max`、`batteryOwnership=OWNED|BAAS` 组合。先过滤全量台账，再计算同条件总数及分页；0有效，空项省略，范围须为非负整数且下限不大于上限。车龄按真实首次登记日及上海日期计算完整月，未知或未来日期不归入0月。
- `GET /api/admin/vehicles/filter-options` 仅提供当前实际合作归属的合作商id/name目录，支持 `cooperationSearch/page/pageSize`，不拿登记人或待核查候选代替合作商。高级筛选及该目录仅ADMIN/OPERATIONS可用。详见 [车辆台账筛选](api/vehicle-ledger-filters.md)。
- `GET /api/admin/baas-contracts` 的 `keyword` 仅搜索关联车辆的VIN/车牌；`provider/lesseeName/brand/model` 使用模糊匹配，对应 `providerExact/lesseeNameExact/brandExact/modelExact` 使用精确匹配，同一项不可同时提交两种模式。保留 `vehicleId/status/page/pageSize`，筛选与总数一致。
- `GET /api/admin/baas-contracts/filter-options` 返回 `providers/brands/models:[{brand,model}]/lessees`，保留 `vehicleId` 限定并支持品牌联动，不返回收款账户等无关字段。承租人来自合同 `lesseeName`，电池规格来自合同 `batteryPackage`，缺失值保持未登记。权限沿原 `baas-contracts.read`，财务可读，SUPPORT/FIELD不可读。详见 [BaaS列表筛选](api/baas-list-filters.md)。

### BaaS登记修正、有效分组与合同附件（2026-11-05）

- 列表增加 `group=CURRENT|EXPIRED|OTHER`，先过滤再计数及分页；返回 `serverDate`、`groupCounts` 和每项 `validityGroup/validityState/validityLabel`。有效中须实际启用、资料完整且上海当日在合同日期内（含结束日）；仅曾启用且实际结束日已过的完整记录归入已过期，其余如待完善、未到期、暂停、归档明确显示原事实。
- `PATCH /api/admin/baas-contracts/:id` 可修正登记资料，非草稿须 `changeReason`；保持 revision/idempotencyKey、当前权限及原生命周期校验。真实条款变化在同事务内封存原版本闭区间、完整条款、摘要及首账期锚点，旧成本/付款/冲正仍用原条款重算并校验；新成本使用当前条款。详情的 `history` 为不可变财务条款版本，`recentChanges` 为最近20条登记修改摘要，包含修改说明和字段名，不回传收款账户内容。
- 完整且当日有效、有有效专用附件的草稿或尚未启用的归档，可显式启用；继续保留单车一个ACTIVE数据库约束。登记、修改、上传均不自动启用、不自动生成成本；原成本全周期与补账语义保持不变。
- 合同专用文件列表返回 `state=ACTIVE|VOIDED` 及作废人、时间、说明，隐藏已删除记录。`POST /api/admin/baas-contracts/:id/files/:fileId/void|remove` 接受 `{revision,idempotencyKey,reason}`，父版本CAS并记录审计；重放须同文件、同动作、同内容且当前权限有效。
- 普通读取只允许当前有效专用附件；已作废文件可从同路径追加 `/history` 读取；删除后两条读取路径均404。处置永久保留原绑定、文件和共享内容，通用/公开文件路径仍拒绝访问。有效专用附件用于启用及新生成成本，已成功生成命令的幂等回放、独立COST付款证据不受影响。
- 后台折旧策略、市场样本、CSV导入、残值曲线、车辆预测、人工估值移到“折旧管理”，原资源路由和角色权限保持不变。

### BaaS八项登记、商品展示和共用相册修正（2026-11-05）

- BaaS登记兼容旧页面 `previousContractId="无"` 或空白为无承接，原成功命令摘要及回放规则不变；无效承接返回409 `BAAS_PREVIOUS_CONTRACT`，真正当前合同缺失仍404。修改保持版本、修改说明及审计；保存不自动启用。
- `registration-context?vehicleId&contractId` 和 `payer-options?keyword&page&pageSize` 供有登记权限的后台查询本车登记所有人、代付人推荐和合作商主数据目录。新增可空 `payerOwnerId`；不回填、不创建租赁合作资格。详情和列表返回 `actualContractNumber/currentPayer/registrationReadiness`。
- 激活、恢复和商品BaaS就绪判断共用八项：合法VIN、实际合同编号、与登记所有人一致的承租人、出租公司、起租日、月租、每月支付日及明确代付人，以及当前有效签署PDF。电池规格、税和宽限选填。旧季/年付资料不自动换算。启用人工确认冻结登记和PDF摘要；旧16项财务条款hash及历史成本校验保持。
- 新BaaS上传仅PDF；历史图片仍可授权读取、作废、删除但不满足签署PDF要求。第75迁移只新增nullable代付人引用及索引/FK，并从旧激活CHECK移除电池规格强制项，保留五项财务、付款及单车ACTIVE约束。
- `GET /admin/goods/:id/app-preview` 复用客户目录投影，当前可见商品使用LIVE，草稿使用不可申请的DRAFT_PREVIEW。`PATCH /admin/goods/:id/presentation` 仅修改共享展示标题/介绍/车况文字，使用商品和车辆双版本、幂等及当前权限，不修改产品版本价格和条款。
- 小程序车辆详情的 `galleryUrls` 从公开封面及 `mediaFileIds` 构建，封面优先并按序去重；轮播与点击预览同源，不暴露私有文件。后台去掉车辆电池Tab旧归集栏目，原材料保留。
- 保单登记选车使用 `/admin/vehicles?keyword&page&pageSize` 服务端模糊车牌/VIN/车型查询，跨页跨搜索保留已选，未知提交和回读阶段不可更改。

### 车辆激活、产品方案与整体商品上架（2026-11-05）

- `Vehicle.status=PUBLISHED` 表示车辆已激活，独立布尔 `catalogPublished` 表示整体车辆商品上架；普通车辆新增/修改、车辆激活和单个方案发布均不能写入该布尔。第76迁移仅新增此列，并按既有已激活车辆和正式公开有效方案的精确集合初始化；原字段、订单和已发布产品条款保持。
- `GET /api/admin/vehicles/:id/activation-readiness` 返回 `{vehicleId,vehicleRevision,ready,checks:[VEHICLE_INFO]}`。原 `POST /admin/vehicles/:id/publish` 仅检查车辆基础资料、状态、占用、当前权限及版本，不要求合作商、保单、照片或产品方案，不改变商品展示或冻结车况。停用已整体上架车辆返回409 `CATALOG_WITHDRAW_REQUIRED`，须先商品下架。
- `GET /api/admin/vehicles/:id/catalog/readiness` 返回原七项就绪检查，以及 `catalogPublished/vehicleActivated/publishedPlanCount/blockers`；检查合作商、有效方案、当日双险、照片、适用时BaaS登记、三项基本车况和车辆基础信息。另需车辆已激活、未被订单预留或占用，以及至少一个已正式发布、可见、active且来源有效的方案。
- 唯一整体入口 `POST /api/admin/vehicles/:id/catalog/publish|withdraw` 接受严格 `{revision,idempotencyKey,reason?}`，返回 `{id,vehicleId,revision,status,catalogPublished}`。当前车辆和商品双权限、Vehicle→Listing锁、CAS、审计和同内容幂等回放均保留。整体上架冻结当前三项基本车况到公开方案并增加各方案revision；下架仅关闭父开关，保留方案、产品版本及旧订单。
- 父商品下架时，或方案仍隐藏时，单方案发布只要求正式产品版本、范围、绑定及来源摘要有效，并保留原状态、占用、权限、CAS；不启用父商品、不冻结车况。父商品已上架时，新增可见方案发布或将已发布隐藏方案改为可见会重新检查七项并冻结当前车况；草稿的可见设置仍为草稿资料。
- 公开车辆列表、首页推荐、详情及admin的App展示状态使用同源正向资格：车辆已激活、`catalogPublished===true`、方案正式PUBLISHED且visible、plan active、产品版本PUBLISHED、绑定/范围/摘要有效。下架、待确认、来源未核实、草稿和未知状态均不进入；先筛全量有效车辆，再计算total/品牌和分页/推荐。有效商品因占用等原因不可申请时仍可浏览；零有效方案详情404。后台原因码新增 `CATALOG_NOT_PUBLISHED`。
- 新客户申请在当前归属验证后、Vehicle锁内再次检查父商品开关，防止旧页面在下架后提交。已成功同键同内容申请仍回放原结果；已提交申请后续报价、旧订单、续期和历史读取不增加父商品门槛。


### 普通账单退款后待收状态（2026-11-06）

原应收仍有效的普通月租、押金和附加费用账单，在可信退款成功回调或异常收款独立核对通过后，于同订单锁、同事务内重算 `Bill.paidAmount`（当前净入账金额）。历史 `Payment` 和 `Refund` 原交易事实不改写；订单资金视图的 `receivedAmount` 为累计成功实收，`refundedAmount` 为累计成功退款，`netReceivedAmount` 为净收。

净入账小于应收时账单恢复 `PENDING`（待支付），余额为 `amount-paidAmount`；到期日早于北京时间当天的余额由逾期账单列表展示。部分退款后的新支付仅收余额；处理中退款阻止新的补款。重复成功回调不重复入账。首期或押金不足且尚未交车时，从待交车返回待支付；已经实际交车的订单不退回交车流程。

已取消、已完成、还车结算中、订单变更义务、服务段账单及权益购买继续按各自资金安排处理，普通账单重算不得重建已终止或被替代应收。含未核对或归属异常收退款的账单须先完成原有财务核对。


### 资格资料内容一致性与本单衔接（2026-11-06）

- 新资格版本保存服务端 `profileSnapshot`，按客户主体字段及各分类证件内容摘要判断资料变化；相同内容重传可沿用审核。客户资料保存去重仅在同一客户、同一证件分类内复用原文件，规范化后仍校验跨分类文件唯一。
- 新资格提交和审核必须包含当前已分类身份证正反面及驾驶证，不能用旧证件材料审核新资料。过期、材料缺失/跨客户、主体信息变化继续阻断。旧资格只有原哈希匹配或可证明的原业务冻结快照才可复用；不猜测补写旧审核。
- `GET /api/admin/orders/:id/qualification-continuity` 返回本单 `orderId/customerId/revision/ready/canConfirm/messages`，具备有效资格时附带 `qualificationId/qualificationRevision/profileHash/originalScopeHash`。仅有客户资料及订单读取权限的管理员/运营可读。
- `POST` 同路径接受严格 `{revision,idempotencyKey,qualificationId,qualificationRevision,profileHash,originalScopeHash,sameCustomerConfirmed:true,reason}`；说明为去空格后2～500字。要求订单、客户写权限、当前人员会话、最新已通过且有效资格、当前资料/原风控归属和版本一致，并确认仍为同一签约主体。管理员可按普通资料规则自审，其他经办人须独立核对。
- 命令在订单及客户锁、Serializable事务内追加 `OrderQualificationConfirmation` 与审计记录，精确绑定本单、资格版本、资料内容及原审核依据；同键同内容回放，冲突拒绝。后续资料/资格变化自动使旧核对不再适用。原订单条款、风险审核和已签合同不改写，也不豁免资金、保险、交接等其他条件。
- 后台本单“客户资料”可沿用当前证件提交新资格、完成审核及本单更新证件核对；资格未满足提示直接定位本单入口。客户资格当前状态附加 `recheckReasons:[{code,message}]`，历史版本状态独立保留。

## 2026-11-06 产品工作台电池筛选

`GET /admin/vehicles`（包括 `view=product-selection`）支持组合 `batteryOwnership=OWNED|BAAS` 和 `batteryCapacityKwh` 精确匹配，容量单位kWh，大于0、最多三位小数且不超过99999.999。空条件由前端省略。列表与total共用同一全量筛选，分页和全选沿用条件；仅ADMIN/OPERATIONS且有车辆读取权限可用。产品选择列表展示车辆资产中的电池方式及容量，未登记不猜测；条件只筛选具体车辆，不改变车型级适配、已选ID及产品定价。


## 2026-11-07 V3.1 合同资料来源（Task 2）

- 既有合作商创建及 `POST /admin/partners/:id/profile` 的 `profile` 增加可选 `contractProfile`：`serviceContactName/serviceContactChannel`，可选 `serviceContactEmail`，`signerAuthorityRole: LEGAL_REPRESENTATIVE | AUTHORIZED_REPRESENTATIVE`；授权代表另须 `authorityScope` 和非空 `authorityEvidenceFileIds`。法定代表人可复用当前已核验法大大身份同意记录绑定的 legalRevision/legalName 及既有代表证据，不要求重复上传委托书；资料就绪不授予签署资格。原会话角色、revision、幂等及审计继续生效。
- 产品草稿增加可选 `customerBaas`，历史空值不回填。`INCLUDED`/`NOT_APPLICABLE` 只带 `disposition`；`SEPARATE` 必须另带正整数分 `amount`、`period: MONTH | TERM` 和真实 `recipient`。保存、重建、复制来源及产品/商品快照保留此字段；不从车辆 BaaS 成本或电池出租方收款资料推定客户费用。省略 `minimumTermMonths` 的更新按持久化值校验实际期限。
- 电子合作条款草稿增加可选 `v31Sources`：非空 `vehicleScopes`（每辆车实际 `validFrom/validUntil`、出租权限 `authorityEvidenceFileIds`、`rightsRestrictions`），非空 `productVersionIds`，非空 `templateRefs: {id,hash}[]`。限制状态为 `UNKNOWN`，或带证据的 `NONE`，或带具体说明及证据的 `DISCLOSED`；未知不等于无。未出单车辆可保存有证据的 `insuranceArrangement`。仅实际例外维护 `exceptions: {description,evidenceFileIds,confirmedBy}[]`。新增版本的电子条款哈希覆盖上述来源及本轮确认的常规账期规则/确认来源；不改写历史哈希。
- `GET /admin/partners/:id/agreements/:versionId/contract-readiness`：仅当前 ADMIN/OPERATIONS；版本必须属于路径合作商。返回 `{ready,snapshot,hash,missing}`，是资料来源就绪检查。缺项带 `field/reason/sourceResource:{type,id}/maintenanceKey/route`；`maintenancePath` 是 `route` 的兼容别名，具体页面由 Task10 挂载。未齐资料仍可保存草稿。结果仅有企业身份、产品、车辆、保单及资格的版本/摘要/证据引用，不返回个人证件明文或完整私密收款账号。
- 内部公共接口 `resolveV31Sources(tx,{kind,resourceId,revision,businessHash})` 从真实业务记录派生主体及来源 ID，校验业务版本/hash。当前已接入 SUBSCRIPTION 订单及 COOPERATION 系列版本；其他种类在对应业务任务接入前返回 `V31_CONTEXT_UNSUPPORTED`。`freezeV31Sources` 返回分离的 JSON 快照及 canonical hash，`assertV31SourcesCurrent` 拒绝冻结或现行来源变化。准备/发起签署仍须沿用原实名、证书、印章、权限及归属校验；Task3/5–8 将来源冻结接入各类文书，不因资料读取调用真实渠道。

## 后台订单列表（V3.1 Task10a）

`GET /admin/orders` 为只读安全摘要列表，需当前有效员工、岗位及会话版本，允许 orders.read；FIELD 无权限。查询参数仅接受 `keyword`（去首尾空格、最多100字符、无控制字符）、`status`（OrderStatus）、`page`（1–10000整数）、`pageSize`（1–100整数，默认20）。非法参数返回400 VALIDATION。关键字按客户名、订单id（即当前订单号）、当前实际车辆车牌/VIN做大小写不敏感字面模糊匹配，先筛选再分页/count；排序 createdAt DESC、id DESC。

响应 `{items,total,page,pageSize}`，items 仅含 id/status/revision/createdAt、customer `{id,name}`、vehicle `{id,plateNumber,brand,model,vin}` 或 null、vehicleContext（CURRENT/LAST/CONFIRMED 或 null）、productName、months、monthlyFeeAmount（整数分）。不返回客户档案、手机号、身份、账户、风险或完整方案快照。当前车辆按同订单/客户 currentAssignmentId 读取；未交付取确认车辆，已结束取最后有实际交付凭据的已关闭分配；不把待换车辆当成当前车辆。条款按有效版本（含已生效阶段）或原确认方案，换车优先冻结 currentVehicleProductSnapshot，未来待生效续期不覆盖当前值；不使用可变商品现价。缺失/不一致来源返回 null，后台明确显示待核。

## V3.1 Task3 完整模板与准备

LegalDocument 新增七个 ELECTRONIC_V31_* 类型，创建和激活须验证完整结构及47标记映射；草稿正文审定后仍通过原确认/激活流程启用。新电子准备仅支持 SUBSCRIPTION 和 COOPERATION 主协议，冻结 Task2 服务端派生的完整 snapshot/hash/context；新准备、START 和新 UPLOAD/SIGN 重新核对来源。结果查询/记录、下载和撤回不受新增实时来源检查阻断。独立授权和后续文书未完成各自业务绑定前明确拒绝准备。

合作 v31Sources 可保存显式 productDepositRules，每个 productVersionId 唯一完整覆盖：CREDIT_POLICY/ZHIMA_MANUAL_V1 或 FIXED/整数分 amount；草稿可暂缺，准备必须齐全。模板引用仅接受已审定 ELECTRONIC_V31_SUBSCRIPTION，冻结完整内容，02 PDF 包含可阅读固定正文及完整源字节。接口字段、哈希语义和 Task6/10 接入约束详见 [Task3 接入说明](api/v31-task3-integration.md)。


### V3.1 首次订阅与实际交付（Task5）

新增电子方案DTO、真实约定价费组成、计划交付日与首期预付款、三方主体来源、线上本人确认、实际交付原始起租锚点及下游接口，见 [V31 Task5 integration](api/v31-task5-integration.md)。该专篇为本接口契约的组成部分；Task11须同时校验 `NEW_ORDER_CONTRACT_MODE=ELECTRONIC` 与 `CUSTOMER_IDENTITY_POLICY=SIGNING_REQUIRED` 的受控启用组合。

### V31 05 期前取消与晚到核验（Task8b）

`GET admin/order-renewals/:id/cancellation-v31` 和 `POST admin/order-renewals/:id/cancellation-v31/:action` 提供真实双方期前合意收件、核验/补证/拒绝、技术激活纠正、独立依赖处置、既有退款申请及来源绑定财务关闭。精确请求字段、权限、证据文件入口、当前财务投影和 Task9 交接见 [V31 Task8 integration](api/v31-task8-integration.md#task8b-real-prestart-agreement-evidence-and-correction)。取消案历史 `FINANCE_CLOSED` 不替代当前 `financialStatus`；迟到真实款项仍需全额原路退款和独立核账。04/06、实际收车、05后再次03和 Task9 时钟/财务总闭环仍按各自任务推进。

### V31 原订阅交付前取消04（Task8c）

新增 `admin/orders/:id/cancellation04` 来源/提案、`admin/cancellations04/:id/review`、客户 `customer/orders/:id/cancellation04` 与 `customer/cancellations04/:id/confirm`，使用专用04完整模板和 CUSTOMER→OWNER→PLATFORM 手签。已核验真实三方解除时间、无争议金额确认、电子签时间、归档和真实退款分别保存。实际字段、证据/权限/双人资金约束和 Task9 逐项费用来源见 [Task8c 接入说明](api/v31-task8-integration.md#task8c-original-never-delivered-cancellation04)。电子 `/admin/orders/:id/cancel` 强制版本及幂等，普通上传PDF不再构成取消依据；电子 cancellation-readiness 返回 version2。依法单方解除、06/收车、05后03、Task9资金总闭环及UI尚属各自后续任务。

未成立、从未交付且无外部请求/未核资金的零资金订阅仍可业务撤销（无01任务或仅无外部attempt的PREPARED）；不制造04生效事实。未知或部分签署须核对原渠道。既有 Refund 通过017/018专用case及不可变 proposalHash 绑定真实04义务，同债后续退款仅更新执行证据；首次制文带真实截至时点，既有待签/已签PDF和原确认时钟不改写。金额确认事实ID/哈希、具体费用权利人/责任/证据及稳定条目引用供Task9消费，不能由原账单类别推断费用变成租金。


### V31 已生效电子续期阶段内换车03（Task8e）

现有 Task7 报价、客户确认、完整03手签、真实旧车收回/新车交付、事实金额确认、独立资金和当期付款命令接通真实已激活05阶段。阶段来源校验、补差账单/义务/付款及用量段归属、旧期历史保留和 Task9 精确来源交接见 [Task8e 接入说明](api/v31-task8-integration.md)。`Bill.serviceStageId` 指向真实阶段，阶段内序号由唯一 `ServiceObligation.stageSequence` 关联取得；不新增账本或改写原stage/已签PDF。共用电子换车事实资金复核按实际 `staffPersonId` 独立，ADMIN普通事实自审不授予资金自审。Task9资金总闭环、四端UI、真实渠道和正式发布仍由各自后续任务负责。

V3.1 退款义务、官方工作日历、真实金额确认及 Task9b–9d 消费边界见 [Task9 金融集成接口](api/v31-task9-integration.md)。义务不等于渠道受理或到账，金额和原触发时间不可手工编辑。 03 原金额确认通过不可变资金快照保留逐付款首次范围与时钟，晚到实收须独立精确确认且不清除核账标记。实际收车后无需先同意整份经济结算即可独立确认无争议现金；原异议继续保留。收车更正对已有独立现金确认进入既有财务复核，并分别暴露原现金确认来源。



## V3.1 Task10b shared electronic workspace (2026-11-08)

Authoritative reachable routes/DTO details are in [Task10 integration](api/v31-task10-integration.md).

- Admin/customer/scoped owner-H5 electronic-document lists accept `orderId,page,pageSize` and return `{items,total,page,pageSize}`, stable createdAt/id descending, maximum100 per page with explicit further pages; retired/stopped history is retained.
- Each prefix adds `GET workspace/:orderId`, `GET :id/dependencies`, `GET :id/dependencies/:dependencyId`. Historical reads keep current ownership/role checks without new-signing qualification gates. Dependencies bind selected frozen original/cooperation/grant versions and keep their independent access permissions.
- Safe DTO additions: `archive`, `frozenSources`, `filingStatus`, separate original/later verification dates; no raw identity/account source bodies. Stopped final evidence is distinct from business archive.
- Workspace proactively exposes actual lifecycle preparation sources, current role/canPrepare and responsible permitted resource/action targets without first creating a task. Local channel capability and external genuine-channel UNKNOWN acceptance remain separate; no invented manual acceptance gate.
- Typed related handover/cancellation/unilateral facts, immutable contractual notice evidence and existing9b refund/manual-investigation targets retain original authorities. In-app reminder readAt never establishes external receipt or consent.
- GET admin/orders adds source-proven `vehicleContext:SWAP_RETURNED` (“已收回／待新车交付”), original VIN/plate searchable before pagination; corrupt/missing sources fail closed. Existing10a current stage fee/product/RBAC semantics remain.
- PC/H5/miniapp/field mounting remains10c–10e; provider/real transaction/signature acceptance remains root11. No deferred9c/9d engine, migration, deployment or real channel action is included.


Task10b fix1: readiness `revision` is the current preparation command revision; `sourceRevision` separately binds the quote/confirmation fact, and `businessHash` binds the actual frozen source (04/06 proposalHash).03/05 never substitute quote revision for OrderChange revision. Known tagged per-signer eligibility failures block that subject, preserving authorized historical/workspace readers. All document kinds preserve authoritative structured missing fields with exact responsible resource/role and permitted maintenance destination. See Task10 integration for command keys and unchanged reader-denial boundaries.

Task11b指定虚拟验收的端点、固定金额、MANUAL_ONLY及旧客户端共存开关见 [V3.1 virtual acceptance](api/v31-virtual-acceptance.md)。普通匿名OFFLINE/MANUAL_REVIEW不变；真实范围/文书审批和发布由主控另行办理。

Task11g 企业中心安全投影：`verificationDisplay.identity` 返回当前法人、企业及当前同意证明匹配的 `complete/state/verifiedAt`；不含供应商身份字段。实名完成与证书有效性、24小时本地核验新鲜度分开；渠道现有证据无独立企业实名到期日，不据证书过期开放重复实名。已完成当前身份的 `/verification` 在写入同意、审计及调用渠道前返回 `409 OWNER_IDENTITY_COMPLETED`，原换法人/旧证明重新绑定检查保留。`POST /owners/:id/seal` 可附 `imageHash`（64位SHA256），在原选章事务中校验，变化返回 `409 OWNER_SEAL_CHANGED`；新页面选章发送预览绑定摘要。

Task11g fix1 用户规则修订（覆盖上文材料变化时旧证明可重绑定的描述）：认证材料快照存于账户现有consentSnapshot.materials（企业类型/名称/信用代码及法人姓名、手机号摘要、原始凭据摘要和版本）。文书联系地址、文书联系电话和普通联系方式不属于认证材料；营业执照/注册地址变化通过原始凭据evidenceHash体现。真实材料变化在原修改事务内保存旧证明审计并置REAUTH_REQUIRED，暂停新签署、已选印章及技术/业务自动用印。已登记供应商账号的信用代码不同须新建主体。原材料不变的既有认证不失效；无快照旧记录仅在首次真实修改前记录legacy-before快照，或同资料查询时记录legacy-matching快照，不伪造原始认证时的材料采集。已变更材料不能由旧编号refresh/回调恢复；当前法人新同意后复用同一provider customer新建一次认证编号，新URL和证明绑定材料摘要。未知/处理中禁止重复或并行修改。当前同材料PENDING仅经明确同意继续原链接/编号。安全DTO仅投影currentAttempt、REAUTH_REQUIRED及历史企业/法人名称与保存时间，不返回私密凭据。


### Task11h 客户资料与实名锁定（2026-11-09）

`GET /customer/profile`、`PUT /customer/profile` 增加安全 `identity` 投影：可信记录为 `{verified:true,locked:true,name,maskedIdCardNo,verifiedAt}`；已实名但依据暂不可读为 `{verified:false,locked:true}`，未实名为 `{verified:false,locked:false}`。仅本人、供应商来源且已绑定的实名依据可显示姓名及脱敏证件号。原始号码、密文及供应商标识不返回。该事实独立于准入政策和签署证书新鲜度；不改变申请快照及签署就绪含义。

保存仍要求 revision CAS 和 idempotencyKey。已实名改名返回 409 `IDENTITY_IMMUTABLE`，拒绝写入任何字段；资料依据不可读时也不开放改名。同名证件关联、驾龄更新允许，手机号和身份证号仍不属于严格资料写入 schema。手机号是登录验证身份，另一个手机号注册新客户，不迁移或合并历史资料。

小程序以个人信息／证件资料两个页签展示；未实名姓名、普通客户驾龄完成输入后保存，上传／替换／移除立即保存关联，成功应用服务端投影。无变化跳过；未知网络结果重试原请求和原幂等键，409 须重新读取核对。资料保存不调用申请补件，只有显式“提交补充资料”更新 NEEDS_INFO 申请。

### 后台新资格材料上传与当前资料保存（2026-11-10）

- `POST /admin/customers/:id/qualification-files` 接受 multipart `file` 与 `idempotencyKey`，仅当前有效且有客户写权限的管理员／运营使用。文件按路径客户归属保存，同时保留上传人员；仅有效 JPEG、PNG、PDF，最大 10 MiB。返回 `{id,name,mimeType,size,url}`。上传本身不替换当前证件、不创建资格审核结论。
- `POST /admin/customers/:id/qualifications` 新增可选 `documents:{identityFrontFileId,identityBackFileId,drivingLicenseFileId}`。提供时必须明确三个不同文件，并与 `identityFileIds` 的两项和 `drivingLicenseFileIds` 的一项一致。文件须属于路径客户，继续执行文件用途、内容摘要和资产隔离校验。不提供时沿用既有当前分类证件一致性校验，不能仅上传任意附件后绕过校验。
- 同一事务先核对原 `profileHash` 与资格 `revision`，再更新当前客户三类证件并创建 `SUBMITTED` 资格版本。新资格绑定更新后的资料摘要和证据；同客户同分类相同内容重传复用原引用，无实质资料变化不提升资料版本。姓名、手机号、实名及其他个人资料不会由此命令改变。
- 失败整体回滚；同键同内容回放原结果，冲突拒绝。历史资格、申请和订单快照及原照片保留，人工审核和本单资格衔接继续独立办理。
- 后台分别上传身份证人像面、国徽面和驾驶证，每槽重选即替换待提交文件；上传中禁止提交，失败保留输入。客户或资料摘要变化后清除旧草稿，提交成功刷新客户详情和资格资料。沿用当前证件入口只提交已读取的原引用。

### 后台客户实名认证展示（2026-11-10）

`GET /admin/customers` 和 `GET /admin/customers/:id` 为管理员、运营附加安全 `identity` 投影：`{status:VERIFIED|NOT_STARTED|PENDING|FAILED|UNKNOWN,verified,locked,name?,maskedIdCardNo?,verifiedAt?}`。列表仅查询当前分页的本地实名依据；读取不调用供应商、不更新业务状态。其他角色沿用现有最小客户信息，不返回专用实名投影。

只有可核验的已完成实名依据才显示认证姓名、脱敏身份证号及时间。认证开始中归为 `PENDING`；证明不完整、不可读或未经确认的状态显示 `UNKNOWN`，不能误标为已实名或未实名。签署证书有效性及本次签署就绪独立于已确立的实名事实。后台列表显示实名认证状态和认证姓名，详情补充脱敏证件号和认证时间；不会用身份证上传或人工驾驶资格审核代替实名认证。

### 后台合作商企业认证与印章展示（2026-11-10）

`GET /admin/partners` 与 `GET /admin/partners/:id` 在原管理员／运营读取权限内增加统一 `enterpriseVerification` 白名单投影：`{applicable,identity,certification,seal,checkedAt}`。个人主体 `applicable:false`，不标记为企业认证未完成。列表批量读取本次返回企业的持久依据；不请求供应商、不更新认证或业务状态。

`identity` 提供 `state/complete/label/message/verifiedAt`；状态包含 `COMPLETED/REAUTH_REQUIRED/PROCESSING/PENDING/FAILED/NOT_STARTED/UNKNOWN/NOT_APPLICABLE`。只有当前企业、当前法人关系、同一认证交易及材料、同意证明完整匹配时才返回认证企业名称、信用代码、法人姓名。历史材料变更可以提供有限的原企业／法人姓名说明，不返回原始证明对象。缺失或无法确认依据显示待核实，不以企业登记状态代替完成实名。

`certification` 与 `seal` 独立提供展示状态和说明；`seal` 另含已选标记及选用／核验时间。证书核验陈旧不抹去已完成实名或既有选章事实；主体变更、印章归属异常、多枚有效选择等不能显示为当前签署已就绪。供应商标识、交易号、证书序列号、密文、完整手机号、印章图像及签章权限不进入此投影。

这些展示字段不授予签署或自动用印能力。合作条款、签署原件、用印授权、收款来源及各命令仍使用各自现有的权限、revision、幂等和业务门禁。

## 2026-11-10 产品中心广告词（新增，发布状态以本轮证据为准）

ADMIN/OPERATIONS 新增 `advertising-copy.read/write`；FINANCE/SUPPORT/FIELD 不开放。公开广告文案匿名读取，不影响车辆、费用与审核业务。固定 12 组 `{id,title,lines:[string,string],catalogDescription}`，id/顺序沿用随包初始集；主标题最多 9、首页每行 32、选车小字 40 Unicode 字符；非空、trim、单行纯文本、对象严格拒绝未知字段。

- GET `/admin/advertising-copy`：`{id:"discovery",revision,draft:{items,contentHash,updatedAt,updatedBy},published:{version,items,contentHash,publishedAt,publishedBy},history:[{version,contentHash,publishedAt,publishedBy}]}`，history 最近 10 条。
- PATCH `/admin/advertising-copy/draft`：`{revision,items,idempotencyKey}` → `{id:"discovery",revision,draftHash,publishedVersion}`。只保存草稿，不变更公开内容。
- POST `/admin/advertising-copy/publish`：`{revision,draftHash,idempotencyKey}` → `{id:"discovery",revision,version,contentHash}`。精确核对已保存草稿摘要，整套原子发布，不接受前端直接提交未保存内容。
- GET `/admin/advertising-copy/commands/:action/:key`：当前员工须同时具备读写权限；action 为 `SAVE_DRAFT` / `PUBLISH`，key 为原命令幂等键。仅查本人及本模块回执，精确返回 `{found:false}` 或 `{found:true,requestHash,result}`，result 为原成功结果。无写入副作用；requestHash 为规范化原请求体的 SHA-256。结果未知时先查此接口，只有明确不存在才可原体原键重放；匹配成功回执后仅 GET 核对，网络失败、404、畸形响应或摘要冲突均不得当作不存在。
- GET `/public/advertising-copy`：`{version,contentHash,publishedAt,items}`，`Cache-Control:no-store`，只投影已发布快照，不含草稿/操作者/历史。

revision 冲突 409 `REVISION_CONFLICT`，摘要变化 409 `DRAFT_CHANGED`，内容与现行发布一致 409 `ADVERTISING_COPY_UNCHANGED`，同键异参 409 `IDEMPOTENCY_CONFLICT`。后台写入需现有 session/origin/CSRF，并在 serial 事务重新核对当前员工后才读取幂等回执；状态、不可变发布记录、审计与回执同事务。初始化迁移以当前 12 组建立 v1，主体标记 SYSTEM_MIGRATION，GET 不偷偷初始化。

小程序进入/刷新读取并轮换，筛选不换字；严格校验发布结构且迟到旧版本不倒退。文案 4s 超时/失败继续最近验证的发布快照或随包初始正式文案，不回退任何车辆/订单 Mock。后台保存和发布命令独立，会话绑定恢复原体原键；成功后 GET 失败只重试 GET。完整设计：`docs/superpowers/specs/2026-11-10-advertising-copy-center-design.md`。


## 企业平台自动签 scope v3（2026-11-11）

- 原企业 H5 的 authorities 请求、查询、继续、暂停/恢复、取消入口复用；v3 scope 由 authority-options 返回，服务端固定平台、授权企业、晓浪受托方及应用绑定，不接收车辆、订单、价格、授权日期范围。
- 客户发起的订单合同：客户 MANUAL，企业出租方与宁达在双方有效授权下 AUTO；合作协议类：合作商固定 MANUAL，宁达在自身有效授权下 AUTO。授权书自身及历史 MANUAL_ONLY 任务不得自动签。
- 授权证据为渠道原交易的实际签后 PDF、文件哈希、证书验签、法人及公司材料快照。状态=1 不能单独触发自动签。新授权仅作用于签署任务准备前已签完并核验的授权。
- GET /api/admin/vehicle-owners/:id/authorities/:authorityId/platform-document：管理员/运营读取受保护的实际授权 PDF；资料变更后仍可查档。
- POST 同路径 refresh-platform-scope：管理员/运营仅查询原授权状态，不代签。
- POST 同路径 review-platform-scope：仅管理员；revision、signedSha256、granteeName=上海晓浪网络科技有限公司、platformContracts=true、dualRepresentation=true、accepted=true。保存针对实际签后全文的审计核验；原合作业务限制继续校验。
- 全局 OWNER_AUTO_SIGNING_ENABLED=false 时只办理授权；此次准备发布不启用自动签。撤销先本地停用，保留原文件与交易，查询成功前不恢复。公司或法人材料、证书/印章不再匹配时授权失效。

## 发布保险解耦与实际交付在保核查（2026-11-12）

上架的 VEHICLE_INFO/PARTNER_INFO/PRODUCT/PHOTOS/BAAS/CONDITION 六项不读取保险。新购车辆可以先建立、发布商品；单台、批量、恢复展示及车辆商品总开关沿用同一发布规则。

普通交车及换车新车交付，按实际交付时刻核对交强险 COMPULSORY_TRAFFIC、商业险 COMMERCIAL，二者必须均有效。当前 REGISTERED 或 APPROVED 版本、保单期间、退保/移出车辆批改、附件用途及逐车绑定、原件真实字节与摘要均须通过；有效替代保单可满足同一险种，不要求一次覆盖整个租期。

缺项返回 DELIVERY_INSURANCE_COMPULSORY_TRAFFIC_REQUIRED / DELIVERY_INSURANCE_COMMERCIAL_REQUIRED，资源为本车 vehicles，订单处理投影通过既有 OPEN_BUSINESS_RECORD 定位 insurance 页签。最终交付事务重新读取，不能使用上架状态或先前查询结果代替；交付审计保存实际时刻、车辆、产品及采用的保单版本编号。续期、历史保单投影及在租提醒保持现状，不恢复保障要求管理。


## 产品 ROA 定价参考（2026-11-13）

内部路径前缀 `/admin/pricing-reference`，资源权限 `pricing-reference.read/write`，角色 ADMIN、OPERATIONS、FINANCE；SUPPORT/FIELD 不可访问。生成产品草稿额外检查当前员工 `products.write`。所有写入需要来源/CSRF 校验、`revision`、`idempotencyKey`，事务内复核员工状态，冲突返回现有标准错误结构。

| 方法与路径 | 行为 |
| --- | --- |
| GET/POST `/scenarios` | 读取/追加经营场景版本 |
| GET/POST `/curves` | 读取/追加车型残值系数曲线版本 |
| GET/POST `/reviews` | 读取/追加单车 review 版本；列表可按 vehicleId 筛选 |
| POST `/preview` | 根据当前有效来源生成预览，不持久化，不作为历史记录 |
| GET/POST `/runs` | 分页读取/生成不可变测算记录 |
| GET `/runs/:id` | 读取冻结快照与逐组采用结果，不重新计算 |
| POST `/runs/:id/groups/:groupKey/drafts` | 将该记录中的一个冻结分组保存为独立产品草稿，不发布 |

参数写入：`{revision,idempotencyKey,lineageId?,payload}`。新参数 revision=0；新版本带 lineageId 和最后版本的 revision。响应包含 id、lineageId、version、revision（等于 version）、payload、createdAt、createdBy。更正和撤回只追加，不支持原地修改/删除。

场景 payload 包含 name、managementVehicleCount、monthlyManagementBudgetCents、occupancyRate（0..1）、targetAnnualRoa（小数比例或 null）、expectedMonthlyMileageKm、variableCostPerOccupiedMonthCents、otherFixedMonthlyCostCents、disposalCostCents、oneTimeCostCents、notes。可空成本 null 表示未知，0 表示明确无成本。金额均整数分。

经营场景 v2 使用 `costModelVersion:2`，保留 name、managementVehicleCount、occupancyRate、targetAnnualRoa、expectedMonthlyMileageKm、notes，新增 productTermMonths（3..120 整数）、repeatOrderRate、badDebtRate（0..1）、baasMonthlyBudgetCents、insuranceAnnualBudgetCents（可空金额）、vehicleCosts、enterpriseCosts、marketing；不再同时传送 v1 的成本合计字段。v1 仍可读取/使用，旧快照不重算。

每条成本 `{id,label,basis,amountCents,quantity,allocationMonths?,startDate?}`；金额可空，数量为非负数，每类最多 100 项且 id 唯一。车辆 basis 为 HOLDING_MONTH、HOLDING_YEAR、OCCUPIED_MONTH、OCCUPIED_KM、IDLE_MONTH、PER_CYCLE、FUTURE_SETUP、DISPOSAL；企业 basis 为 MONTH、YEAR、AMORTIZED_ONCE，最后一种必须填写发生日期和正整数分摊月数。marketing 为 `{fixedBudgetCents,conversionMonths,coverageVehicleCount,newOrderCostCents,repeatOrderCostCents}`，三个金额可空，周期及非空覆盖规模须正整数；覆盖规模 null 表示采用 managementVehicleCount。固定推广按折算月投入持续计入，非预算到期自动归零。

逐车 override 另支持 `includeSetupCosts?:boolean`，默认 false，不追计已支付的牌照/初始投入。oneTimeCostCents 与 disposalCostCents 为对应合计覆盖，不与明细重复累加。分组 draft.months 优先于场景默认产品期限，用于周期订单及营销成本。结果增加 expectedGrossRevenueCents、badDebtLossCents、collectibleRevenueCents；标准化车辆输入冻结实际期限、来源及成本分解。

曲线 payload 包含 name、modelDefinitionId、year（车型年款）、batteryOwnership、batteryCapacityKwh、configuration、mileageMinKm、mileageMaxKm、condition、effectiveFrom、valuationDate、source（MANUAL/MARKET）、sourceNotes、points（ageMonths/coefficient 正值点）。人工来源不得伪装成统计市场数据；有效范围内插值，不做默认外推；相同优先级多条匹配需明确选择。

review payload 包含 vehicleId、observedAt（估值日期）、effectiveAt（ISO 时刻，兼容 YYYY-MM-DD 按上海零点解释）、ageMonths、mileageKm、valueCents、curveId（可空）、notes、withdrawn。更正/撤回必须带同一 lineageId，不能借更正改变车辆范围。新测算仅使用生成时已知、已生效且估值日不晚于定价日的有效记录。

预览输入：`{scenarioVersionId,pricingDate,exitDate,groups,vehicleOverrides}`。groups 为 `{groupKey,vehicleIds,draft}` 数组；draft 使用现有 v2 产品 DTO，不含命令字段，必须准确重复本组 vehicleIds 且 modelDefinitionIds=[]。后端核验真实车型、年款、电池方式/规格一致，车辆不能跨组重复；单次上限 1000 辆，剩余经营期大于 0 且不超过 120 月。

分组可带 `customerBaasIncomeTreatment`（BUSINESS_REVENUE / THIRD_PARTY_DIRECT）和 `customerBaasIncomeBasisNotes`。产品客户电池费为 SEPARATE 时，未明确该口径及依据则 ROA 缺项；经营收入按原始整数分金额及月份比值计算，TERM 不提前舍入到整数月费。该内部口径不写入客户产品快照。

逐车 override 包含 vehicleId，以及可选 curveId、conditionConfirmed、exitDate、disposalCostCents、oneTimeCostCents、baasMonthlyBudgetCents、insuranceMonthlyBudgetCents、assumptionNotes。指定曲线/成本预算必须说明依据；车况适用性未确认时返回缺项。已知合同和保费不会被缺覆盖预算覆盖成零。

生成记录在预览输入上增加 `revision:0,idempotencyKey,recalculatedFromId?`。响应 `{id,revision:0,createdAt,createdBy,scenarioVersionId,recalculatedFromId,snapshot,adoptions}`。snapshot 冻结原请求、知识截止时刻、标准化引擎输入、经最小化投影的来源事实、逐车和分组结果。历史读取/导出不读取最新参数。adoptions 为已生成产品/版本 ID；每 runId/groupKey 唯一，即使换幂等键重试也复用结果。

结果包括逐车定价日与退出残值、参考上限、管理分摊、年化 ROA、保本与目标基础费、缺项原因；分组包括计算覆盖数、资产加权 ROA、低/中/高值、全组最小上限、组目标与逐车达标目标、冲突与超限车辆。部分数据不完整不冒充全组结果，也不新增产品保存/发布的财务阻断。

`GET /admin/vehicles?view=pricing-selection` 提供定价选车的最小车辆元数据，额外检查 pricing-reference.read。财务可用此视图，不扩大既有 product-selection、车辆台账高级筛选或合作归属读取权限。定价内部成本和快照不加入客户商品/合同响应。

操作说明：[产品定价参考](product-pricing-reference.md)。
