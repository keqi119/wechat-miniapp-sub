# 残值、事故维修与车辆保养首版设计

日期：2026-10-31。状态：主控已审阅，按分阶段方案施工。第①阶段纯计算包 `residual-market/{calculations,csv,dimensions}.ts` 与两份专项测试已完成，待独立复核；该包不含业务 service/controller、schema 或数据库操作，其余能力不能据此视为已上线。承接 10 月 30 日需求第 2.6、2.6.2、2.6.3 项及已实现的资产、折旧、成本台账。电子签、OFFLINE 换车门禁维持现状。

## 1. 依据与边界

需求来源：`D:\工作资料\宁达订阅\系统\宁达订阅系统需求澄清20261030.txt`。项目基线：`2026-10-16-miniapp-independent-platform-design.md`、`2026-10-31-rebuild-reference-rules.md`、`2026-10-31-vehicle-assets-design.md`、`docs/api-contract.md`、`docs/api-vehicle-assets.md`。

旧仓库只读取 `D:\Projects\auto-subscription-platform` 的 Git 对象 `db4b48c55890f11f52c4fc52c29242d7c0d150be`，没有读取其工作树来代替固定提交，也没有连接旧库。核查路径：

- `apps/api/src/residual-market/{residual-market.service.ts,csv-parser.ts,dto/residual-market.dto.ts}`：样本去重与导入、车龄分组、分位数、曲线生效、预测与采用。
- `apps/api/src/vehicle-valuation-review/{vehicle-valuation-review.service.ts,dto/vehicle-valuation-review.dto.ts}`：独立估值复核，旧批准动作更新售价并设置三个月复核日期。
- `apps/api/src/asset-operations/{asset-operations.repository.ts,asset-operations.service.ts,asset-operations.types.ts,vehicle-availability.ts}`：工单、证据、状态、车辆限制。
- `apps/api/src/asset-accounting/{asset-accounting.service.ts,asset-accounting.domain.ts,asset-accounting.types.ts}` 及该提交 `prisma/schema.prisma`：实际成本、冲正、追偿事实和关单校验。

首版实现市场样本、统计曲线、单车预测、独立人工估值复核，以及运营创建/处理/验收的事故维修和保养工单。财务确认内部成本。残值预测、人工估值、事故记录及成本均不自动改产品月费、最终方案、客户账单、押金、权益、里程政策或折旧策略。

不包含投资分析、ML 模型运行、自动报价、自动事故扣价、自动派工、真实保险赔款 API、自动维修商付款、自动客户追偿。客户 `ServiceRequest` 是客户服务记录，不能作为内部工单表替身；关联它也不自动创建费用或完成客户服务。FIELD 不获得资产全车读取/写入权限。

## 2. 选择及现状差异

推荐在现有模块化 API 内增加 `residual-market`、`vehicle-valuations`、`asset-work-orders`，成本仍交给 `asset-costs`，文件仍交给资产专用文件控制器。另建一套维修财务账容易重复确认与冲正，整体移植旧 accounting/authority 则会带入无关主体和业务例外，两者都不采用。

当前 `Vehicle` 有车型主数据、车辆年份、里程和电池健康度，但没有旧平台的 `currentSalePriceAmount`、`purchasePriceAmount`、系列/配置款或电池容量字段；`VehicleAssetProfile` 已有首次登记日及 UNKNOWN/OWNED/BAAS。当前产品 v2 月费由已冻结基础费与里程月价组成。不能把旧售价更新代码机械接到某个现有金额字段。

首版估值批准只形成独立 `VehicleValuationReview` 结果与下次复核日；“当前人工估值”查询最新有效批准记录，不增加自动收费桥接。主控已确认本阶段按此实施，不为旧模块补建售车业务。旧预测残值率以采购价为分母，本项目没有可信采购价时返回 `null`，不得拿折旧基数、租金或曲线参考价冒充。

## 3. 原统计规则必须保留

规则版本建议 `RESIDUAL_STATISTICAL_V1`；记录 `referenceCommit` 和独立 `sourceHash`，以后变算法必须另立版本。

1. 新样本、新曲线必须指定真实 `modelDefinitionId`，品牌/车型/已知年款从该主数据冻结，不能靠自由文本自动推断。旧源码保留无车型 FK 的历史样本匹配支路，本项目空库不制造这种历史数据。样本可保留原始系列/款型文字供人工核对，不用它替代主数据。
2. 样本车龄：有显式 `vehicleAgeMonths` 优先；否则使用观察日期与登记日期的**自然月差，不减未满日**。缺失或负数车龄不进入曲线，并列出跳过原因。单车预测则使用已满月差：当预测基准日的日小于登记日，月差减一，再取不小于零。两处是固定提交的不同规则，分别命名 `sampleCalendarAgeMonths` 与 `vehicleCompletedAgeMonths`，不能合并成一个“修正后的车龄”函数。
3. 样本仅取 ACTIVE，按车龄月分组，默认每点至少 3 条。默认价格类型依次为 TRANSACTION/AUCTION/DEALER_QUOTE/INTERNAL_SALE/LISTING，不默认含 ESTIMATE。里程、事故、健康度保留为样本事实和统计信息，首版没有里程分桶或事故系数。
4. 每组价格升序。分位数位置为 `(n-1)*q`，在相邻值间线性插值，最后四舍五入到整数分；q 为 1/4、1/2、3/4。中位数为预测值，P25/P75 为上下界；均值同样四舍五入到分。记录 min/max/样本数/样本 ID、版本、原金额及 hash。
5. 样本置信分沿用旧计算：40 起，品牌+车型、观察日、正价格、里程、登记日或显式车龄各加 10，电池容量和城市各加 5，最多 100。点置信分为 `min(100, round(平均样本置信分*0.6 + min(样本数*5,40)))`，曲线置信分为点置信分均值取整。它不是价格保证或金融风控结论。
6. 同维度 ACTIVE 曲线只能一条。维度为车型 ID、冻结车型年款、款型、电池容量、电池归属；没有的可选维度规范化为 null 后参与 dimensionHash。价格类型和样本日期是来源筛选，不因它们不同放出第二条同维度 ACTIVE。启用新曲线将原同维度 ACTIVE 转 SUPERSEDED，历史预测仍用原快照。
7. 单车默认预测 0/6/12/24/36 月，目标日期按原日期加月并夹到月末；目标车龄=基准车龄+预测月数。命中曲线点用 EXACT，两个有效点之间用 LINEAR_INTERPOLATION；范围之外标 UNSUPPORTED，金额和上下界为 null，不外推、不填零。
8. 所有金额计算使用 BigInt 有理数商余数再舍入。输入/单笔持久化遵守现有 Int 分上限 2,147,483,647；合计返回前检查 JS 安全整数。正价格的半分向上，递减曲线也按完整正结果舍入，不能对负差单独取整。残值率以基点计，只有有效分母才计算。
9. CSV 继续支持 BOM、引号、逗号、换行、空白行，逐行返回 IMPORTED/SKIPPED_DUPLICATE/FAILED。元转分使用十进制字符串解析和四舍五入，不用 `Number(text)*100` 引入二进制误差。固定提交的去重优先 source+规范化 sourceListingId；无来源条目 ID 时取 source/观察日/冻结品牌车型/车型 ID/年款/里程/城市/价格类型/金额的规范化元组。数据库唯一约束处理并发重复，不能仅先查后写。

首版正式单车预测要求选择 `curveId`，服务端核对车型及所有非空维度；使用当前 ACTIVE 曲线。只读试算可选择 DRAFT，必须明确显示“未生效曲线”。旧代码的自动模糊择优及指定 curveId 后跳过车型核对不复制；这是输入可靠性边界，不改变插值计算。

## 4. 残值数据与接口

### 4.1 数据

| 新模型 | 必需字段与不变量 |
| --- | --- |
| MarketPriceObservation | id/revision、modelDefinitionId FK、modelSnapshot、source/sourceListingId、observedOn、priceType/priceAmount、batteryOwnership、batteryCapacityKwh、mileageKm、registrationDate、vehicleAgeMonths、province/city、trim、conditionGrade、batteryHealthPercent、accidentFlag、sourceUrl/sourceNote、dedupeKey、confidenceScore、status ACTIVE/IGNORED/VOIDED、importBatchId 可空、createdBy/At；金额/观察事实不原地覆盖，更正需作废原样本并新建 correctionOfId |
| MarketPriceImportBatch | id/revision、csvHash/fileName/source、status COMPLETED/PARTIAL_FAILED/FAILED、输入行数与成功/重复/错误数、逐行结果 JSON、createdBy/At。最多 1,000 数据行、2 MiB 文本，超限拒绝；不写本地任意路径 |
| VehicleResidualCurve | id/revision、name、status、dimensionHash、dimensionSnapshot、filterSnapshot、algorithmVersion、sourceSnapshot/sourceHash、pointCount/sampleCount/skippedReasons、effectiveFrom、supersededAt、createdBy/At。生成后统计来源不可编辑 |
| VehicleResidualCurvePoint | id、curveId FK、ageMonth、sampleCount、median/p25/p75/average/min/maxPriceAmount、predictedResidualRateBps 可空、confidenceScore、sampleSnapshot；唯一 curveId+ageMonth |
| VehicleResidualForecast | id/revision、vehicleId/curveId FK、asOfDate、status GENERATED/ADOPTED/ARCHIVED/VOIDED、vehicleRevision/assetRevision/curveRevision、inputSnapshot/curveSnapshot/sourceHash、createdBy/At |
| VehicleResidualForecastPoint | id、forecastId FK、horizonMonth/targetDate/targetAgeMonth、status GENERATED/ADOPTED/UNSUPPORTED、interpolationMethod、金额/区间可空、匹配点及权重快照、adoptedAmount/adoptReason/adoptedBy/At；唯一 forecastId+horizonMonth；原预测值不可被采用金额覆盖 |
| VehicleValuationReview | id/revision、vehicleId FK、forecastPointId 可空 FK、source FORECAST/MANUAL、requestedAmount/reason、beforeSnapshot/sourceSnapshot/sourceHash、status PENDING/APPROVED/REJECTED/CANCELLED、approvedAmount、decidedBy/At、decisionReason、nextReviewDate。终态不改金额，后续复核新建记录 |

`VehicleAssetProfile` 可新增 nullable `batteryCapacityKwh Decimal(8,3)` 作为车型维度核验事实，由既有资产入口和 revision 管理，不填默认容量。OWNED 对应旧 BUYOUT；UNKNOWN 不能匹配指定 OWNED/BAAS 曲线，未限定该维度的曲线仍可试算。预测必须有首次登记日，不能用 Vehicle.year 或车型年款补造日期。曲线不要求补录当前缺失采购价；曲线 `referencePriceAmount` 是其显式试算参考分母，独立冻结。

### 4.2 公共类型和 DTO

所有 object strict，未知字段拒绝。日期为真实 `YYYY-MM-DD`，时间为带时区 ISO，服务端业务日为 Asia/Shanghai。`Money` 为 0..2,147,483,647 整数分，`PositiveMoney` 为 1..上限；revision 非负 Int；id 非空字符串；key 长 8..128；Reason 为 trim 后 1..1,000 字；pageSize 1..100。

```ts
type Command = { revision: number; idempotencyKey: string };
type ReasonCommand = Command & { reason: string };
type Evidence = { fileIds: string[] }; // 1..20，不重复，所属资源专用映射
type PriceType = 'LISTING'|'TRANSACTION'|'AUCTION'|'DEALER_QUOTE'|'INTERNAL_SALE'|'ESTIMATE';
type PriceSource = 'MANUAL'|'CSV_IMPORT'|'INTERNAL_DISPOSAL'|'DEALER_QUOTE'|'AUCTION'|'USED_CAR_PLATFORM'|'OTHER';
type ObservationInput = {
  modelDefinitionId: string; modelRevision: number; source: PriceSource;
  sourceListingId: string|null; observedOn: string; priceType: PriceType;
  priceAmount: number; batteryOwnership: 'UNKNOWN'|'OWNED'|'BAAS';
  batteryCapacityKwh: string|null; // 非负十进制字符串，最多三位小数
  mileageKm: number|null; registrationDate: string|null; vehicleAgeMonths: number|null;
  province: string; city: string; trim: string; conditionGrade: string;
  batteryHealthPercent: number|null; accidentFlag: boolean|null;
  sourceUrl: string|null; sourceNote: string; correctionOfId: string|null;
};
type CurveRequest = {
  modelDefinitionId: string; modelRevision: number; name: string;
  trim: string|null; batteryOwnership: 'OWNED'|'BAAS'|null;
  batteryCapacityKwh: string|null; priceTypes?: PriceType[]; // 缺省为第3节五种价格类型
  sampleStartDate: string|null; sampleEndDate: string|null;
  referencePriceAmount: number|null; minSamplePerPoint?: number; // 默认3，1..1000
};
type ForecastRequest = {
  curveId: string; asOfDate: string; horizonMonths?: number[]; // 默认[0,6,12,24,36]，1..10项、去重、0..120
};
```

创建样本接 `Command(revision:0)+ObservationInput`。可空字段显式 null，普通文字可空字符串；sourceNote 必填来源说明；sourceUrl 只存 http(s) 来源文字，不服务端抓取。priceAmount>0；里程/车龄非负整数，健康度 0..100 整数。无法产生车龄的样本仍保存并在曲线跳过，不擅自猜年龄。附件后续上传到已建样本，追加证据不改变已冻结曲线来源。

| 路由 | 精确输入和返回要点 |
| --- | --- |
| GET/POST `/admin/residual-observations`；GET `/:id` | GET query page/pageSize、modelDefinitionId/source/priceType/status/observedFrom/observedTo；POST 见上。列表 `{items,total,page,pageSize}`，detail 返回白名单观察字段、revision、去重/更正关联、专用文件元数据，不返存储路径 |
| POST `/:id/ignore|restore|void` | ReasonCommand；ACTIVE↔IGNORED，ACTIVE/IGNORED→VOIDED，VOIDED 不复活；恢复必须重查唯一键。所有旧曲线保留被冻结原观察事实 |
| POST `/admin/residual-imports/preview` | `{source,fileName,csvText}`；只读返回 `{csvHash,rows:[{rowNumber,action,normalized?,duplicateId?,errorCode?,message?}],counts,previewHash}` |
| POST `/admin/residual-imports` | 上述输入+Command(revision:0)+previewHash；同键重放。重算差异返回 PREVIEW_CHANGED；已预览的无效行逐行记录，不因它们丢弃有效行；非预期 DB 错误回滚整个批次，不能当普通 CSV 错误吞掉 |
| POST `/admin/residual-curves/preview` | CurveRequest；只读 `{dimension,points,sampleCount,skippedReasons,algorithmVersion,sourceHash,previewHash}`；hash 绑定样本 ID/revision/状态/数值及车型 revision |
| POST `/admin/residual-curves`；GET 列表/`:id` | CurveRequest+Command(revision:0)+previewHash，保存 DRAFT；零有效点拒绝创建。列表筛 modelDefinitionId/status，详情返回冻结点和来源摘要 |
| POST `/admin/residual-curves/:id/activate|archive` | ReasonCommand，activate 另带 `effectiveFrom:DateOnly`；首版生效日为上海今天，不安排后台自动定时生效。DRAFT→ACTIVE，同维度旧 ACTIVE→SUPERSEDED；DRAFT/ACTIVE/SUPERSEDED→ARCHIVED；源与历史点不重写 |
| POST `/admin/vehicles/:id/residual-preview` | ForecastRequest，只读返回 `{vehicleId,vehicleRevision,assetRevision,curveId,curveRevision,algorithmVersion,points,warnings,previewHash}`；无首次登记日/未知曲线/维度不符拒绝 |
| POST `/admin/vehicles/:id/residual-forecasts` | ForecastRequest+Command(revision:vehicleRevision)+assetRevision+curveRevision+previewHash；保存 GENERATED 及各点；GET `/admin/residual-forecasts` 按 vehicleId/status 分页，GET `/:id` 读冻结事实 |
| POST `/admin/residual-forecasts/:id/points/:pointId/adopt` | Command(revision:forecastRevision)+`{amount:PositiveMoney,reason}`；必须同 forecast 且非 UNSUPPORTED，每点只采用一次；不覆写预测、不写车价 |
| POST `/admin/residual-forecasts/:id/archive|void` | ReasonCommand；保留采用及复核引用。被采用/已批准估值引用的预测不得 VOID，只可归档 |
| POST `/admin/vehicle-valuations` | Command(revision:0)+`{vehicleId,vehicleRevision,source:'FORECAST'|'MANUAL',forecastPointId:string|null,forecastRevision:number|null,requestedAmount:PositiveMoney,reason}`；FORECAST 必须精确关联同车可用点；MANUAL 无 forecast 字段，必须上传依据后才可批准 |
| GET `/admin/vehicle-valuations`、`/:id`；POST `/:id/approve|reject|cancel` | 列表筛 vehicleId/status；approve 为 ReasonCommand+`{vehicleRevision,approvedAmount:PositiveMoney,fileIds}`；reject/cancel 为 ReasonCommand。approve 将当前日期加 3 月夹月末设 nextReviewDate；仅保存估值事实，不写客户交易或折旧 |

嵌在 `/admin/vehicles` 下的两种残值动作必须在服务内再校验 `residual-market` 权限，不能把既有 `vehicles.write` 当作足够权限。建议实现时也可统一移至新资源路由，但须同步定稿契约，不能客户端和服务端各写一套。

## 5. 内部事故维修与保养数据

| 新模型 | 核心字段 |
| --- | --- |
| AssetWorkOrder | id/revision/workOrderNo、vehicleId FK、kind ACCIDENT_REPAIR/REPAIR/MAINTENANCE、status、priority LOW/NORMAL/HIGH/URGENT、occurredAt、title/description、sourceServiceRequestId 可空 FK、relatedWorkOrderId 可空同车 FK、assignedStaffId 可空、providerName/contact、scheduledAt 可空、costConfirmationRequired、noCostReason、solution、acceptedBy/At、closedBy/At、cancelReason、createdBy/At；事故/理赔事实见下 |
| AssetWorkOrderEvent | id、workOrderId FK、sequence、action、actorId/At、before/afterRevision、detailSnapshot/sourceHash；唯一 workOrderId+sequence。追加记录，不能改掉原证据和验收结论 |
| VehicleOperationalRestriction | id/revision、vehicleId/workOrderId FK、status ACTIVE/RELEASED、scopes ALLOCATION/DELIVERY、reason、createdBy/At、releasedBy/At/releaseReason、evidenceSnapshot。只影响新的占车/交付，不取消当前租赁归属或拦截安全还车 |
| VehicleMaintenanceSchedule | vehicleId PK/FK、revision、sourceWorkOrderId 可空 FK、lastCompletedOn/lastMileageKm、nextDueDate/nextDueMileageKm、reason、updatedBy/At；两个下次条件可各自 null，但不能同时 null 时宣称已有提醒规则 |
| AssetWorkOrderCost | id/revision、workOrderId/vehicleId FK、category REPAIR/MAINTENANCE/TOWING、status DRAFT/FROZEN、amount、occurredOn、supplierName/referenceNo、reason、sourceSnapshot/sourceHash、replacesCostId 可空 FK、createdBy/At。财务专用真实费用来源；FROZEN 后不可 PATCH |
| AssetRecoveryRecord | id/revision、workOrderId/costEntryId FK、status RECORDED/VOIDED、kind INSURANCE_RECEIPT、amount、receivedOn、referenceNo、reason、evidenceFileIds/evidenceSnapshot、recordedBy/At、voidedBy/At/voidReason。只是人工依据登记，不是渠道 Payment；不抵销 COST 原额 |

首版事故事实在工单中用显式字段 `accidentAt/location/description/insurerName/claimNumber/claimStatus`，claimStatus 为 NOT_REPORTED/REPORTED/PROCESSING/SETTLED/REJECTED/WITHDRAWN；非事故工单这些字段为 null。SETTLED 只表示人工登记理赔处理结论，不表示款项到账。修改需版本、原因及事件；不引入泛型 JSON PATCH。事故车辆责任、客户赔偿金额不因这里的记录自动确认。

`sourceServiceRequestId` 只作可选来源线索：服务端读取其客户、订单和事件发生时的真实车辆分配证据，验证属于本车，冻结最小关联摘要。不接任意 customerId/orderId 冒充关联，不默认 `ServiceRequest.orderId` 的初始车就是事故时当前车。无法确定历史换车归属时拒绝关联，由运营先核实；仍可独立建立不关联客户的真实工单。同一服务记录可明确关联多次维修，不自动合并其状态。

## 6. 工单命令、状态与车属

工单创建输入：

```ts
type CreateWorkOrder = Command & {
  vehicleId: string; vehicleRevision: number;
  kind: 'ACCIDENT_REPAIR'|'REPAIR'|'MAINTENANCE';
  title: string; description: string; occurredAt: string;
  priority: 'LOW'|'NORMAL'|'HIGH'|'URGENT';
  sourceServiceRequestId: string|null; relatedWorkOrderId: string|null;
  costConfirmationRequired: boolean; noCostReason: string|null;
  accident: null|{accidentAt:string;location:string;description:string};
};
type MaintenanceCompletion = {
  completedOn: string; mileageKm: number;
  nextDueDate: string|null; nextDueMileageKm: number|null;
  scheduleRevision: number; reason: string;
};
```

默认不推断“免费保养”；costConfirmationRequired 必须显式提交，false 必须有 noCostReason。该字段只能在 PENDING 时、无任何费用来源/计划/事实时更正。完成里程是工单事实，不自动写客户已核读数或重结用量；服务端核对其不低于该车已确认可信读数，冲突要更正来源，不能直接覆盖。下次日期晚于 completedOn、公里阈值高于本次里程；无下次规则返回空并明确提示。

| 接口 | 输入 / 状态结果 |
| --- | --- |
| GET/POST `/admin/asset-work-orders`；GET `/:id` | 列表 query page/pageSize、vehicleId/kind/status/assigneeId/priority；创建见上 revision:0。返回显式 operational DTO，财务金额/付款附件不混入运营投影 |
| PATCH `/:id` | Command+可选 title/description/priority/costConfirmationRequired/noCostReason，仅 PENDING；不能改车、来源或状态 |
| POST `/:id/assign` | Command+`{assigneeId:string,providerName:string,contact:string,scheduledAt:string|null,reason}`；受派人为当前 ACTIVE ADMIN/OPERATIONS。外部维修商只记录名称联络信息，不创建平台访问权 |
| POST `/:id/start|wait|resume` | ReasonCommand；PENDING→IN_PROGRESS，IN_PROGRESS→WAITING_EXTERNAL，WAITING_EXTERNAL→IN_PROGRESS |
| POST `/:id/submit-acceptance` | Command+`{solution,fileIds}`；IN_PROGRESS→PENDING_ACCEPTANCE，必须本工单有效运营证据；保养另含 MaintenanceCompletion，先冻结候选，尚不改提醒头记录 |
| POST `/:id/accept` | Command+`{reason,fileIds}`；验收证据及完成资料再核验。需成本则→PENDING_COST_CONFIRMATION，否则→CLOSED；无成本关单时确认无未决费用来源。保养接受时以 scheduleRevision CAS 更新提醒并留事件 |
| POST `/:id/return-for-work` | ReasonCommand；PENDING_ACCEPTANCE/PENDING_COST_CONFIRMATION→IN_PROGRESS。原验收和费用事实保留，不能清掉已确认成本 |
| POST `/admin/asset-work-order-costs/:workOrderId/close` | ReasonCommand；只允许 PENDING_COST_CONFIRMATION，至少一笔同工单未冲正实际成本，且无未决 DRAFT 费用或 SCHEDULED 计划。财务独立入口，不由普通运营 PATCH 触发 |
| POST `/:id/cancel` | ReasonCommand；非终态可申请，但必须无未冲正成本、无待处理费用/计划、无 ACTIVE 车辆限制；已发生事实和取消理由仍保留 |
| POST `/:id/notes` | Command+`{note}`；追加真实处理记录；终态只允许追加说明，不能借说明改变状态/金额 |
| POST `/:id/claim` | Command+`{insurerName,claimNumber,claimStatus,reason,fileIds}`；仅 ACCIDENT_REPAIR，附件属于本工单；真实到账另走财务人工登记 |
| POST `/:id/restrictions` | Command+`{vehicleRevision,scopes:('ALLOCATION'|'DELIVERY')[],reason,fileIds}`；同车建 ACTIVE 限制；不得空 scopes/重复 scopes |
| POST `/:id/restrictions/:restrictionId/release` | Command+`{restrictionRevision,vehicleRevision,reason,fileIds}`；同父资源、当前版本、明确解除依据；关闭工单不隐式解除限制 |
| GET/PATCH `/admin/vehicle-maintenance/:vehicleId` | GET `{registered,revision,lastCompletedOn,lastMileageKm,nextDueDate,nextDueMileageKm,dueByDate,dueByMileage,readingAsOf,sourceWorkOrderId}`；PATCH Command+vehicleRevision+`{nextDueDate,nextDueMileageKm,reason}`，仅人工维护未来阈值，不能伪造已完成保养 |

运营验收不等于财务确认。财务关单固定放在独立 `asset-work-order-costs` 路由并校验 ADMIN/FINANCE；`asset-work-orders` 不注册同名通用 close，不能让拥有运营 write 的岗位获得财务权限。上表其余 `/:id` 均指 `/admin/asset-work-orders/:id`。

限制读取与实际执行须接同一 helper：至少覆盖 `orders/business-gates.ts` 新申请占车、`vehicle-changes/assignments.ts` 与 `quotes.ts` 目标车、初次/换车交付业务门禁、车辆可申请目录投影。执行时在已有 Vehicle 锁后重读，不只 UI 灰按钮。原 RESERVED/IN_USE/holdId/assignment 独占仍独立成立。ACTIVE 限制不能自动把 IN_USE 改成 MAINTENANCE，更不能使还车操作失去权限。仅“保养到期提醒”不会自动创建阻断限制，运营按事实明确设置。

## 7. 与现有成本台账的最小衔接

采用 **每笔真实维修/保养费用来源对应一个成本计划**，不放开任意分录创建。沿用确认、锁定、冲正及已验证幂等事务。与 BAAS/折旧不同，同车同月可以多次合法维修，不能套用当前同 sourceKind 全期间互斥。

1. 财务在 `/admin/asset-work-order-costs/:workOrderId/lines` 创建 DRAFT 来源，输入 `Command(revision:0)+{workOrderRevision,amount:PositiveMoney,category,occurredOn,supplierName,referenceNo,reason,replacesCostId:null|id}`。类别白名单为 REPAIR/MAINTENANCE/TOWING；MAINTENANCE 工单只能 MAINTENANCE，维修工单为 REPAIR/TOWING。日期不得晚于上海今天。
2. 对该费用来源上传财务专用证据。PATCH `/admin/asset-work-order-cost-lines/:id` 只限 DRAFT，输入 Command+金额/日期/供应商/凭证号/原因白名单，不改工单、车辆或类别关系。
3. POST `/:id/preview` body `{}`，只读返回 `{lineId,lineRevision,workOrderRevision,amount,costPeriod,periodStart,periodEnd,category,sourceHash,previewHash}`；真实工单必须已验收且处于 PENDING_COST_CONFIRMATION，来源证据完整。
4. POST `/:id/prepare` 输入 Command+`{workOrderRevision,previewHash}`，在同车→工单→来源锁内重算，冻结来源并建 SCHEDULED 计划。periodStart=periodEnd=occurredOn，costPeriod 为该月；计划唯一键是费用来源 ID，不是车/月。状态、版本、审计和幂等结果同事务写入。
5. 复用 `/admin/asset-costs/confirm`，对 WORK_ORDER 来源重新读真实 FK、已验收工单和不可变费用凭证，校验同车/同金额/日期/类别/hash，生成唯一 COST。源状态不是 DRAFT，也不能只凭任意 JSON sourceSnapshot 冒充。
6. `AssetCostPlan.sourceKind` 新增 WORK_ORDER，新增唯一 nullable `workOrderCostId` FK，与 baasContractId/depreciationPolicyId 严格三选一。`AssetCostEntry.category` 增 REPAIR/MAINTENANCE/TOWING；planId 继续必填，原 COST/REVERSAL 唯一性与锁定规则保持。共用 `source.ts` 增 `load/validate` 的 WORK_ORDER 分支和真实 `sourceLock`；未知 source 拒绝，不能落入折旧 else 分支。历史校验核对冻结验收事件及其工单归属，不要求当前工单 revision 仍等于验收时 revision；CLOSED/CANCELLED 后依然能读取原真实来源。只有新生成/重开/确认动作额外检查当前可操作状态，不能用新办理门禁误伤历史读取。
7. WORK_ORDER 不走跨工单日期互斥；改校验同费用来源唯一、替代链唯一与不存在未冲正原成本。BAAS/DEPRECIATION 的期间互斥及折旧累计预算原样保留，不能为维修松掉旧两类校验。来源快照推荐 `{version:1,sourceKind:'WORK_ORDER',sourceId,workOrderId,vehicleId,sourceRevision,acceptedEventId,acceptedRevision,category,amount,occurredOn,evidence:[{id,sha256}],replacesCostId,reason}`，sourceHash 为其 canonicalHash。
8. 错误金额先冲正，新增明确引用原来源/原分录的替代费用来源并重新确认；不能 PATCH FROZEN 来源或覆盖计划。作废/重开采用当前台账规则并重新校验工单可接收成本、来源版本与预览 hash；旧 BAAS/折旧重开接口不改参数含义。
9. 关单至少一笔未冲正 WORK_ORDER COST，且所需费用均已处理。若已关闭工单最后一笔成本需要冲正，新增明确财务 `reopen-cost-review` 命令：ReasonCommand+待更正 entryId/revision，先将工单回到 PENDING_COST_CONFIRMATION 并留“财务更正”事件，再允许冲正。它不撤销物理验收、不解除车辆限制、不自动重开客户服务；避免 CLOSED 展示为“费用完成”而成本已清空。
10. 人工付款扩展须保持整笔复制原成本、同父专用证据、非未来日期、有效付款不得重复及先撤销登记再冲正。首版建议只扩展 REPAIR/MAINTENANCE/TOWING 的已确认 COST，不改变非现金折旧不可付款。付款登记不是支付渠道结果。
11. 人工保险款登记放 `/admin/asset-work-order-costs/:workOrderId/recoveries`，输入 Command(revision:0)+`{workOrderRevision,costEntryId,entryRevision,amount:PositiveMoney,receivedOn,referenceNo,reason,fileIds}`；只有 ADMIN/FINANCE，必须同车同工单有效 COST、本成本专用文件。返回独立 RECORDED 事实，撤销用 recordRevision/原因保留原记录；不创建 Payment，不从 COST.amount 中扣减。仍有有效人工收款登记时，原成本冲正应拒绝，先核实关联更正，不能自动撤销真实收款或假装退款。成本额、付款登记额、保险人工收款额分列，不能相加或自动认定客户应付净额。

对运营列表，最多投影 `costReviewStatus:'NOT_REQUIRED'|'PENDING'|'CONFIRMED'|'CORRECTION_REQUIRED'`，不展开财务来源/发票/银行凭证。财务 DTO 另返回真实 lines/plans/entries/recoveries、分别合计 plannedAmount/confirmedAmount/reversalAmount/netCostAmount/manualPaidAmount/manualRecoveryAmount。任何统计采用整数/BigInt，明确这些合计不能当渠道余额。

## 8. 专用文件与岗位

沿用 AssetPrivateFile 映射，新增 nullable 真 FK：`observationId`、`valuationReviewId`、`workOrderId`、`workOrderCostId`，分别配 kind RESIDUAL_OBSERVATION/VALUATION/WORK_ORDER/WORK_ORDER_COST。已有 BAAS/DEPRECIATION/COST/PLATE 四类保持。总共八个 parent FK 必须**恰好一个非空且与 kind 对应**，不按 purpose 猜测授权。

上传/列表/下载仍为每个父资源 `/files` 和 `/files/:fileId` 的三种专用路由。财务费用行证据在入账前挂 WORK_ORDER_COST，入账后不可搬映射到 COST；确认冻结其 ID/hash，财务成本详情通过有授权的来源关系只读展示。后续付款/保险收款凭证挂实际 COST。运营工单文件不能充当未经核验的财务来源，也不能靠拿到 fileId 读取财务附件。

| 新资源/动作 | ADMIN | OPERATIONS | FINANCE | SUPPORT / FIELD / 客户 / H5 |
| --- | --- | --- | --- | --- |
| residual-market 样本/导入/曲线/预测/采用 | 读写 | 读写 | 只读 | 不新增 |
| vehicle-valuations 申请/取消本人待审 | 允许 | 允许 | 允许 | 不新增 |
| vehicle-valuations 批准/驳回 | 允许 | 禁止 | 允许 | 不新增 |
| asset-work-orders 运营工单/验收/事故资料 | 读写 | 读写 | 核对成本所需只读 | 不新增 |
| vehicle-maintenance 提醒/阈值 | 读写 | 读写 | 无 | 不新增 |
| asset-work-order-costs / lines / 财务关单/更正 | 读写 | 仅独立运营结果状态 | 读写 | 不新增 |
| asset-cost-plans、asset-costs 新 WORK_ORDER 来源 | 读写 | 不返回金额或证据 | 读写 | 不新增 |

`vehicle-valuations` 混合动作不能仅靠资源级 write；approve/reject 在服务内强制 ADMIN/FINANCE。估值申请、结果及其 VALUATION 依据对有估值读取权的运营/财务可见，财务付款凭证不得上传到此共享估值域。每次调用校验当前 staff.active/role/authVersion，角色降级后同幂等键也不能回放旧财务详情。列表和 count/totals 使用相同 SQL 范围；H5 不因资产所有人、牌照归属或维修供应商名称获得任何新权。

files 通用读取、public/media、H5/现场附件和已加固的跨域证据采纳继续按 AssetPrivateFile 映射阻断；新增种类不需要挨个业务消费者猜 purpose。新增专用读取必须重查父资源与当前权限。复用现行 MIME/大小/hash/上传人规范，拒绝跨父资源、多个 FK、缺 FK、错误 kind/purpose/哈希；输出无 storagePath。FIELD 首版不派内部维修任务，如后续要现场填报须另有任务 assignment generation，不扩既有车辆权限。

## 9. 事务、状态与迁移草案

写命令统一 `Db.serial`、当前岗位检查、幂等键、revision CAS 和审计同事务。锁顺序：按 ID 排序的 Vehicle → 资产资料/工单 → 费用来源 → 计划 → 成本 → 人工登记；曲线生成/启用另按 dimensionHash 事务 advisory lock，再锁目标/原 ACTIVE 曲线。同一入口不可先成本后车辆反向取锁。

预览只读，不生成工单、成本、审核、审计或 revision；确认重算 hash。样本状态改变、主数据/登记日改变、曲线改变、工单验收退回、证据变动都会使旧预览失效。已经冻结的历史来源不会跟随实时目录变化重写。幂等相同请求不重复插成本/事件、不同摘要拒绝；命令回放后的敏感 DTO 仍按当前权限校验。

迁移由主控排序追加，不改已应用 005—008：

1. 新增残值七表与资产资料 nullable 容量字段；新表 Money/日期/状态/数量/JSON 形状 checks，真实 FK 使用 Restrict。样本有效去重 unique、曲线 ACTIVE 的 dimensionHash partial unique、curve+age/forecast+horizon unique；估值同一 forecastPoint 的 PENDING partial unique。不批量生成样本/估值/采购价历史。
2. 新增工单、事件、限制、保养提醒、费用来源、人工保险款记录。来源 ServiceRequest 建可空 FK；不把历史客户事故记录自动迁入工单或回填猜测关联。维护同车关系由命令严格核验；费用来源与工单/车辆可采用复合 FK 加强，不能只靠散落 JSON。
3. 扩 AssetCostPlan 来源 FK+唯一，重建来源 CHECK 为三种严格互斥；category 增三项，原 BAAS/DEPR 金额/期间条件不能放宽。新来源的 sourceKey 唯一/单原 COST/单 REVERSAL 约束继续生效。
4. 扩 AssetPrivateFile 八选一 FK/对应 kind 检查，旧记录新增四列均 null，无“自动归类”回填。所需证据数组显式 SQL NOT NULL、长度 1..20、无 null 元素，避免 cardinality(NULL) 的 CHECK 旁路；必要快照必须非空且不是 JSON null。
5. 迁移不重算历史估值、折旧或已有成本，不触及客户账单/UsageAccount/SwapCredit/签署开关。真实执行只走主控允许的本机隔离库 guard；fresh schema 验证包含每个新 SQL 约束的 raw SQL 反例。

## 10. 页面及实施顺序

车辆管理下残值页面采用样本列表/导入结果、曲线列表/点明细、单车预测、人工估值复核四个明确动作区；图表标金额分转换后的元、年龄月份、样本数及 P25/P75，范围外显示缺数据。采用和批准分别操作，不用一个“应用价格”按钮掩盖区别。

事故维修/保养各为内部工单列表及同一工单详情类型视图，展示时间线、运营附件、受派人/维修商、验收、限制和财务结果状态；保养展示下次日期/里程及可信读数日期。客户服务有来源链接而不共用一份状态。财务从待确认费用进入成本来源预览、确认、凭证和冲正/更正，不把运营估计金额直接入账。

建议分批交付：① 原统计纯函数及样本/曲线 + 真隔离库约束；② 单车预测/估值只读及人工复核；③ 真实内部工单/限制/验收/保养提醒；④ WORK_ORDER 成本来源与财务关单、付款及人工保险收款；⑤ 后台联动、跨端权限回归。第③批在限制接入实际占车/交付前不能宣称已有车辆不可交付闭环；第④批完成前需费用的工单停在 PENDING_COST_CONFIRMATION。

## 11. 验收清单

- 旧计算金样例：1/2/3/偶数样本，中位半分、P25/P75、整数上限、递减插值、样本月差与预测满月差的同日/前一日、31日/闰年目标日、默认五种价格、缺车龄/不足三条跳过、范围外金额 null。
- 导入 BOM/引号换行/空行、元字符串半分、非法/溢出/未知车型、同文件重复和并发重复、部分失败报告、同键重试、预览后新增重复；不吞基础设施错误。
- 同维度并发启用仅一 ACTIVE；未知型号/电池维度拒绝；源更改令旧预览失败，历史预测及已采用结果不变；人工估值批准不改变任何产品、月费、合同、折旧及账单。
- 工单归属覆盖无客户车辆、有当前租赁、已换车客户事故、跨车 ServiceRequest/证据拒绝；OPS 验收与 FINANCE 成本确认互不越权；假 FIELD/停用/改岗/旧幂等重放拒绝。
- 占车/换车目标/实际交付均受同一限制影响，安全还车仍可办理；限制竞争与交付竞争持同车锁只有一方成功；关闭不自动解限，提醒到期不自动暂停合同或派工。
- 已验收工单才可冻结费用；费用金额/日期/类别/hash/父 FK 任一篡改拒绝；同车同月两笔不同合法维修可确认，重复来源只能一笔，旧 BAAS 期间互斥和折旧累计预算仍拒绝越限。
- 需成本关单无未冲正 COST 拒绝，有未决费用也拒绝；财务更正保留物理验收和原成本；锁定、已有付款、重复冲正/付款、跨来源替代、同键不同体均拒绝。
- 八类文件 FK SQL 互斥、NULL/省略/NULL 元素 raw SQL、错 purpose 仍按映射封锁、跨父资源/财务附件到运营/公共 media/H5/FIELD 拒绝；列表总数不泄露不可见数据。
- 客户 ServiceRequest 原流程、现有 usage/TERM/OFFLINE 门禁、财务 BAAS/折旧和历史来源读取回归；不调用旧 DB、保险商、支付商或电子签供应商。

## 12. 交主控的最小业务确认点

人工估值仅形成独立评估结果和复核日已由主控明确，不再作为待确认问题。本设计没有新的售车业务。

仅保留一项未来扩展确认：**费用承担及赔款口径**。首版按内部实际成本确认、运营记处理事实、保险款仅人工凭证登记即可实现；若需要客户/资产方/平台分摊、追偿应收或免赔审批，须先确认相应合同依据和业务规则，不从事故工单或保险收款推导客户应付。该问题不阻止本设计首版施工，由主控集中判断是否需要提给用户，不并发提问。

零费用保养/质保维修可用显式 noCostReason，不预设“每次必收费”；保养周期由运营按厂家/实况人工填写，不预设默认几个月/几公里。以上是首版输入要求，不是新增收费条款。
