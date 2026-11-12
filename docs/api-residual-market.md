# 残值样本、曲线、单车预测与估值 API

2026-10-31 本地实现；部署与四入口验收尚未完成。所有路径带 `/api` 前缀。预测与估值后台页面已完成本地专项验证，相关接口和页面均未在生产开放。

## 通用约定

- 市场样本、导入、曲线和预测由 ADMIN、OPERATIONS 读写；FINANCE 只读，包含明确的 POST `/residual-imports/preview`、`/residual-curves/preview`、`/residual-forecasts/preview`。估值申请/证据可由三岗办理，批准/拒绝仅 ADMIN、FINANCE；取消仅 ADMIN 或原申请人。预览仍须有效后台会话、Origin 和 CSRF。其他 POST 不因名称相近自动获得只读权限。
- SUPPORT、FIELD、客户和合作商 H5 不增加本模块权限。每次命令重新校验当前岗位及 authVersion，已撤权的旧幂等请求也不能回放敏感结果。
- 下文省略 `/admin`。所有对象严格校验未知字段。金额除 CSV 明示为元外，均为整数分；日期为有效 `YYYY-MM-DD`。创建 `revision:0`，更新用当前 revision；写入含 `idempotencyKey`。同键同体回放原结果，同键不同体冲突。预览不写审计、版本或业务记录。
- 分页返回 `{items,total,page,pageSize}`，pageSize 1–100。没有可信数据不填零或猜测车型、年款、电池容量、车龄。

## 市场样本

| 方法/路径 | 输入或行为 |
| --- | --- |
| GET `/residual-observations` | page/pageSize，选填 modelDefinitionId、source、priceType、status、observedFrom/observedTo |
| POST `/residual-observations` | Command + 下列完整事实；冻结真实车型 ID、revision、品牌/名称/年款 |
| GET `/residual-observations/:id` | 白名单样本事实、当前版本、去重/更正关联及专用文件元数据，无存储路径 |
| POST `/:id/ignore` | Command + reason；ACTIVE→IGNORED，仍占去重键 |
| POST `/:id/restore` | Command + reason；IGNORED→ACTIVE，重查唯一来源 |
| POST `/:id/void` | Command + reason；ACTIVE/IGNORED→VOIDED，终态不能恢复 |

事实字段：`modelDefinitionId,modelRevision,source,sourceListingId,observedOn,priceType,priceAmount,batteryOwnership,batteryCapacityKwh,mileageKm,registrationDate,vehicleAgeMonths,province,city,trim,conditionGrade,batteryHealthPercent,accidentFlag,sourceUrl,sourceNote,correctionOfId`。

`source` 为 MANUAL/CSV_IMPORT/INTERNAL_DISPOSAL/DEALER_QUOTE/AUCTION/USED_CAR_PLATFORM/OTHER；`priceType` 为 LISTING/TRANSACTION/AUCTION/DEALER_QUOTE/INTERNAL_SALE/ESTIMATE。priceAmount 为正整数分；sourceNote 为必填来源说明。sourceUrl 只允许 http(s) 文字，不在服务器抓取。

`batteryOwnership` 为 UNKNOWN/OWNED/BAAS；容量为最多三位小数的十进制字符串或 null，最大 99999.999。里程、车龄为非负整数或 null；健康度 0–100 整数或 null；accidentFlag 为 boolean 或 null。其余允许缺省事实的字段须明确 null，province/city/trim/conditionGrade 可空字符串。持久化文本拒绝 NUL，普通备注允许换行。

原观察事实不原地编辑。更正需先作废原样本，再创建 `correctionOfId` 指向已 VOIDED 的样本。去重优先 source + 规范化来源条目 ID；缺条目 ID 时使用固定算法的观察事实元组。ACTIVE/IGNORED 占键，VOIDED 释放键；并发有数据库约束兜底。

样本凭据用 `/residual-observations/:id/files` 专用上传/列表及 `/files/:fileId` 下载。只有 ACTIVE/IGNORED 可新上传，历史终态可按当前权限读取原凭据。文件不能用于其它父资源或对客交接。

## CSV 导入

| 方法/路径 | 输入或行为 |
| --- | --- |
| POST `/residual-imports/preview` | `{source,fileName,csvText}`；返回 csvHash、columnContract、逐行 rows、counts、previewHash |
| POST `/residual-imports` | 预览输入 + Command(revision:0) + previewHash；锁内重算来源后提交 |
| GET `/residual-imports` | page/pageSize，选填 source/status |
| GET `/residual-imports/:id` | 冻结输入摘要、统计、逐行结果，不重读当前车型重写历史结果 |

列契约版本 1，金额单位 **CNY_YUAN**。推荐必填列为 `modelDefinitionId,modelRevision,observedOn,priceType,priceYuan,sourceNote`。CSV 的兼容列名 `priceAmount` 也表示**元**；JSON 单条样本的 priceAmount 仍表示分，界面须明确区分。

可选列：`sourceListingId,batteryOwnership,batteryCapacityKwh,mileageKm,registrationDate,vehicleAgeMonths,province,city,trim,conditionGrade,batteryHealthPercent,accidentFlag,sourceUrl`。允许 observedAt→observedOn、remark→sourceNote、batteryUsageType→batteryOwnership，BUYOUT→OWNED；支持“车型ID、车型版本、观察日期、价格类型、价格(元)、来源说明、来源条目ID”对应列。相同语义的两个列同时出现会拒绝，不任意选择其一。未知列拒绝，source 由顶层输入指定，不接受 CSV 自行覆盖。

支持 BOM、引号内逗号/换行、空白行，最多 1000 数据行、2 MiB UTF-8 CSV 文本。仅上述两个 POST 接口容纳 JSON 转义膨胀后的 13 MiB 传输包，其他接口维持原限制；CSV 本体仍执行 2 MiB 限制。传输非法 JSON 返回 400 `CSV_REQUEST_INVALID`，传输过大为 413 `CSV_REQUEST_SIZE_LIMIT`，文本超限为领域 `CSV_SIZE_LIMIT`。

每行结果为 IMPORTED/SKIPPED_DUPLICATE/FAILED；包含行号、规范化事实或明确错误，并可引用数据库重复 ID/文件内重复行。未知车型、旧车型 revision、NUL 等坏行不会污染有效行。已预览的普通坏行可随有效行一起记录为部分失败；数据库故障不能伪装为坏行，整个批次回滚。

previewHash 绑定输入、车型当前版本、重复来源及逐行计划。预览后来源变化返回 `PREVIEW_CHANGED`，须重新预览。已成功同键回放不重复插入样本/批次。批次状态 COMPLETED/PARTIAL_FAILED/FAILED，统计三类行数之和等于 rowCount。

## 统计曲线

| 方法/路径 | 输入或行为 |
| --- | --- |
| POST `/residual-curves/preview` | CurveRequest；返回维度、冻结来源摘要、点、跳过原因、previewHash |
| POST `/residual-curves` | CurveRequest + Command(revision:0) + previewHash；有有效点才可保存 DRAFT |
| GET `/residual-curves` | page/pageSize，选填 modelDefinitionId/status |
| GET `/residual-curves/:id` | 冻结来源、点与计算信息；不以最新市场样本重算旧曲线 |
| POST `/:id/activate` | Command + reason + effectiveFrom；effectiveFrom 必须上海当天，DRAFT→ACTIVE |
| POST `/:id/archive` | Command + reason；DRAFT/ACTIVE/SUPERSEDED→ARCHIVED，保留来源和历史引用 |

CurveRequest 为 `modelDefinitionId,modelRevision,name` 及可选 `trim,batteryOwnership,batteryCapacityKwh,priceTypes,sampleStartDate,sampleEndDate,referencePriceAmount,minSamplePerPoint`。可选维度缺省 null；minSamplePerPoint 默认3（1–1000），priceTypes 默认 TRANSACTION/AUCTION/DEALER_QUOTE/INTERNAL_SALE/LISTING，不含 ESTIMATE。

维度 hash 使用真实车型 ID、冻结年款、款型、电池容量与归属，日期/价格筛选不会放出第二条同维度 ACTIVE。首次启用再次校验当前样本来源，变化则拒绝要求新建曲线；同维度原 ACTIVE 变 SUPERSEDED。幂等回放不把已成功启用误判为来源变化。

统计规则版本 `RESIDUAL_STATISTICAL_V1`，来源固定提交 `db4b48c55890f11f52c4fc52c29242d7c0d150be`。ACTIVE 样本按车龄分组，中位数/P25/P75/均值通过整数有理数四舍五入至分。样本车龄为自然月差，预测车龄为满月差，两者不混用。点保留样本 ID、revision、金额及 hash；任何历史快照不一致都拒绝，不静默修正。

曲线参考价仅用于明确的统计残值率；不是某辆车的采购价，也不改售价、产品费用、客户账单、押金或折旧策略。单车预测不外推，缺数据返回 null。

## 单车预测

| 方法/路径 | 输入或行为 |
| --- | --- |
| POST `/residual-forecasts/preview` | vehicleId、curveId、asOfDate、horizonMonths；只读预览 |
| POST `/residual-forecasts` | 预览输入 + Command（revision为当前车辆版本）+ assetRevision、curveRevision、previewHash |
| GET `/residual-forecasts` | page/pageSize，选填 vehicleId/status |
| GET `/residual-forecasts/:id` | 冻结输入、曲线及预测点；读取不重算当前市场来源 |
| POST `/:id/points/:pointId/adopt` | Command + amount（正整数分）+ reason；记录一次采用事实 |
| POST `/:id/archive`、`/:id/void` | Command + reason；保留历史，无删除 |

horizonMonths 默认 `[0,6,12,24,36]`，可传1–10个不重复的0–120整数。必须有真实车型关联、资产资料和首次登记日期，车辆、电池归属/容量等事实须匹配曲线限定维度；没有款型事实不能匹配限定款型曲线。草稿曲线可预览并明确警示，只有 ACTIVE 曲线可保存预测。保存时锁内重核车辆/资产/曲线版本和预览摘要。

点返回 targetDate、targetAgeMonth、GENERATED/UNSUPPORTED/ADOPTED、predictedAmount/lowerAmount/upperAmount、插值方法和依据。仅在已知点之间插值，范围外为 UNSUPPORTED/null，禁止采用。采购价尚无可信来源，保持 null 并提示 PURCHASE_PRICE_UNAVAILABLE，不把曲线参考价代入采购价。采用不会覆盖预测金额，另存 adoptedAmount/人员/时间/理由；不能重复采用同一点。已经采用或获批准估值引用的预测不能作废，可归档。

## 人工估值复核

| 方法/路径 | 输入或行为 |
| --- | --- |
| POST `/vehicle-valuations` | Command(revision:0)、vehicleId、vehicleRevision、source、forecastPointId、forecastRevision、requestedAmount、reason |
| GET `/vehicle-valuations` | page/pageSize，选填 vehicleId/status |
| GET `/vehicle-valuations/:id` | 申请、冻结的原估值/来源、专用凭据及决策事实 |
| POST `/:id/approve` | Command、vehicleRevision、approvedAmount、reason、fileIds（1–20个本申请专用凭据） |
| POST `/:id/reject`、`/:id/cancel` | Command + reason |

source 为 MANUAL 或 FORECAST。人工来源的 forecastPointId/forecastRevision 必须明确 null；预测来源须为本车真实非 UNSUPPORTED 点及当前预测版本，预测须 GENERATED/ADOPTED，同一点仅一条 PENDING 申请。请求金额和批准金额都是正整数分，可以不同，原申请金额不覆盖。

批准须当前车辆版本及完整专用凭据，冻结前后估值和摘要，nextReviewDate 为批准时上海日期加三个自然月。预测已作废不得批准，但可以拒绝/取消待审申请。历史读与原成功键保留原事实，不以最新曲线、资产资料或估值改写；旧键仍重核当前权限。

附件路径 `/vehicle-valuations/:id/files`，仅 PENDING 可追加。估值记录及采用动作不写客户 Bill/Payment、资产成本、采购价、车辆售价或折旧政策，不触发付款、签署、通知或渠道调用。
