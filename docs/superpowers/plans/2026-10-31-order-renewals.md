# 原单同车续期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. 共享文件由主控明确分配，不自动提交、安装、迁移、部署或启用门禁。

**Status:** 2026-10-31 来源审计与实施方案；本文本轮未修改生产。主控已接受核心模型、显式激活及第 2 节 schema 方向，schema015 由主控单独实施；字段名采用 serviceStageId/stageSequence，INITIAL 允许真实历史来源为空，旧 null 不补造政策。本文描述当前工作树事实，不代表线上现状。

**Goal:** 在原订单、原单号下，通过客户确认及真实纸质补充协议，追加同一实际在用车辆的订阅租期。续期按该车已发布商品的产品月数、月费及里程规则执行；原服务期规则和真实资金、用量、交接记录不改。

**Architecture:** 一个 `Order`、一个 `UsageAccount`、连续真实 `VehicleAssignment`；新增 `OrderServiceStage` 表示各连续租期。未来续期先冻结报价、归档和资金来源，准备未来账单；满足条件后进入 `SCHEDULED`。运营只可在上海生效日或之后显式幂等激活，才追加服务月、条款版本及新期权益。原 `finalPlanSnapshot` 与账户初始价格保留，按服务期/账单/权益自身来源计价。

**Tech Stack:** NestJS、Prisma/PostgreSQL、React 后台、真实版微信小程序、现有合作商 H5 与 FIELD；不增加依赖。

**Spec:** `docs/superpowers/specs/2026-10-16-miniapp-independent-platform-design.md`；`2026-10-31-admin-rebuild-design.md`；`docs/superpowers/plans/2026-10-31-offline-order-changes.md`；`2026-10-31-term-swap-credits.md`；当前真实源码及主控本轮用户确认。

## Global Constraints

- 原订单追加租期，真实纸质补充协议；不新建申请/订单，不伪造还车、交车、里程读数、电子签或实名。
- 仅首版同车、同出租方、当前真实 ACTIVE assignment、尚未实际归还/结单的 OFFLINE 订单。原电子合同与历史读取保留，本包不自行开放新的电子签办理。
- 重新选择当前车已发布商品，服务端取产品 `months/monthlyFeeAmount/mileagePerMonthKm/excessMileagePriceAmount/swapPolicy`；客户端不能覆盖费用、月数、赠送数或起止日。
- 押金保持原已冻结金额和真实资金；新商品仅提供续期月费/租期/使用政策，商品中的押金不得覆盖原合同。
- 新租期赠送重新计算，旧期免费次数到期不结转；已经购买的次数仍按各自原 `expiresAt` 和冻结金额处理，不延长、不改退款价。
- 一个未来续期。客户已确认且尚未撤销/生效的未来续期明确阻断换车；不允许换车后把旧车辆商品静默套到新车。
- 金额整数分，逐期及持久化金额不超 Int；合计用 BigInt 校验后输出。先当前权限/归属，再幂等回放；版本冲突、资金回调与未知结果保护不省略。
- 本计划只读当前项目来源；没有连接数据库、旧仓库、线上或读取配置密钥。schema、迁移、公共权限、门禁及法务发布均由主控持有。
- 普通交易条件变更暂缓；续期不提供任意改价、改押金、变更出租方或重置原期权益的入口。

## Review Focus

- 提前确认、提前付款、纸档完成不使当前费率/赠送提前变化；激活后结算旧服务月仍使用旧价。
- `OrderTermsVersion` 当前要求有效指针指向完整链最后一项。未来续期不能提前插入该表或提前移动指针。
- 全订单服务月 sequence 唯一且只追加，包含已取消月份也不复用；累计超过 120 个月仍有效，各单段产品月数仍为 12–120。
- 普通新购要求车辆 PUBLISHED/空闲。续期必须核当前真实 IN_USE 本车，不经过该分配门槛，也不改变车辆占用。
- 未来付款只能进入冻结续期账单和义务；不能挪用原月已收款，不能作废原账单或停用原 obligations。
- 未确认、未归档、款项未清或尚未激活而旧期已结束时，不能延用旧规则发新期；真实占用及迟到款仍保留，禁止假完成订单。

## 1. 已核实的来源与不能直接复用之处

| 来源 | 当前真实行为 | 续期所需适配 |
| --- | --- | --- |
| `apps/api/src/usage/rules.ts`、`pricing.ts`、`policy.ts` | 初始化一次账户；每月价格与原 `finalPlanSnapshot` 一致；新有效条款改变原里程规则会被拒绝 | 保留原账户校验，增加 stage/period 定位；旧月仍对原来源校验，新月只对本段冻结来源校验 |
| `usage/usage.service.ts`、`ledger.ts`、`returns.ts` | 月结按序；附加里程包从适用 sequence 开始；真正还车才冻结/过期；两处 `voidUnpaidQuotes(...,120)` 假定总月数不超过 120；月结还用 `sequence-1` 查前月 | 改为实际最后 sequence；合法撤销空号后按真实前一服务月且日期连续解析，不盲查 sequence-1；不重建账户，不以续期冒充还车；读数仍来自真实实车事实 |
| `vehicle-changes/assignments.ts`、`segments.ts` | 一个 assignment 可跨多期；`openSegments` 以 period+assignment 幂等创建，连续读数来自前段冻结读数 | 新期沿同一 assignment 加 segment，不能关闭并重新创建 assignment，不能捏造起止里程 |
| `order-changes/context.ts`、`finance.ts`、`obligations.ts` | `financialContext` 根据单个有效条款月份排表；延期 apply 停用全单旧义务、即时换条款指针并要求尚无 UsageAccount | 新建续期服务/财务函数，不能调用 `applyDelay`；全订单汇总按各段/全局 sequence 读取 |
| `order-changes/agreement-readiness.ts`、`agreement-facts.ts` | 完整条款链、原 RENTAL、历次 quote/Contract/归档/pin 严格对应；链指针必须是最后版本 | 未来 stage 在链外但有真实已确认协议/pin；激活时一次追加版本。历史协议仍按原冻结来源验证 |
| `products/snapshot.ts`、`goods/service.ts` | 商品与 PUBLISHED 明确产品版本、plan、listing hash 一致；商品本身可关联在用车 | 专用续期商品查询，核该当前车及可读最小字段；不调用新申请的车辆空闲 claim |
| `applications/applications.ts`、`vehicle-changes/assignments.ts` | 新购/目标换车要求 PUBLISHED、未预留、未占用 | 不适合本车续期；用真实 assignment+车辆占用归属的专用 eligibility |
| `swap-purchases/policy.ts`、`rules.ts`、`ledger.ts`；`vehicle-changes/credits.ts` | 单一原订单 TERM；免费 `orderId+termSequence`；付费购买已持久化 `expiresAt`；按原快照验证退款价 | FREE 改 stage 唯一；新购按当期 stage；历史 paid 按购买来源 stage 和旧期限；批量过期不得误伤下一段 |
| `orders/readiness.ts`、`customer.ts`、`customer-order-view.ts`、`business-gates.ts`、`field-handover/batches.ts` | 多处直接使用有效条款及初始第 1 期资金 | 区分当前段、原始合同、未来段和全订单事实；续期首期是新段首个全局 sequence，不是全单第 1 期 |
| `offline-documents/readiness.ts`、`termination.ts`；`insurance/coverage.ts` | 合作协议可核完整租期范围；保险 coverage 是指定时点判定 | 续期合作范围须覆盖新增租期；保险按办理/生效时点核实，不能把某日可用说成未来数年全部覆盖 |
| `partners/simple-revenue.ts`、`settlements.ts` | 当前来源包含原订单 revenueRuleSnapshot 与真实账单/付款；结算不能只换显示标题 | 新续期账单须可定位 stage 的冻结合作依据；禁止新客户月费反向改历史收益 |
| `entitlements/service.ts` | 原订单 benefits 以 sourceKey 唯一，实际交付激活、实际归还过期；COUNT 与里程/换车专账不同 | 不重复执行原交付激活；新段通用 COUNT 规则未在本次用户确认中定义，见第 8 节有限边界 |

这些适配是一个可启用续期闭环的前置项。仅新增 quote/月份，不修改原价解析器、TERM、资金及结束读取，会造成旧月被拒绝、赠送串期或续期后仍不能还车。

## 2. 给主控的最小 schema 建议

以下是待主控冻结的结构，不是已存在 schema。建议新增一个业务模型，少量可空来源 FK；旧记录允许未关联，续期写入严格要求关联。所有新关系 `onDelete/onUpdate Restrict`，不能靠级联删除历史。

### 2.1 `OrderServiceStage`

| 字段 | 类型 / 约束 | 用途 |
| --- | --- | --- |
| `id` | String PK | 永久段标识 |
| `orderId`、`customerId` | String；复合 FK → Order(id,customerId) | 同单同客户 |
| `sequence` | Int > 0 | 租期段序号，独立于月 sequence；第一段为 1 |
| `kind` | INITIAL / RENEWAL | 原期与续期 |
| `status` | PREPARED / SCHEDULED / ACTIVE / ENDED / VOIDED | PREPARED 已确认/归档/pin/未来义务已建；SCHEDULED 财务满足；ACTIVE 已显式激活；ENDED 已被后续段接续或真实结束；VOIDED 有明确撤销审计 |
| `revision` | Int >= 0，默认 0 | 所有阶段命令 CAS |
| `previousStageId` | nullable；复合 FK (previousStageId,orderId) → Stage(id,orderId) | RENEWAL 非空，INITIAL 空；不能跨单/自指 |
| `changeId`、`quoteId` | nullable，分别 unique；FK (changeId,orderId) → OrderChange(id,orderId)，(quoteId,changeId) → DelayQuote(id,changeId) | INITIAL 空；RENEWAL 必填，一次确认报价对应一个已准备段 |
| `priorTermsVersionId` | nullable；复合 FK 同订单 | 与 change 的原有效链头一致；首次补充协议可能为空 |
| `termsVersionId` | nullable unique；复合 FK 同订单 | 激活才填；未来段禁止提前写有效条款版本 |
| `approvedArchiveVersionId` | nullable FK ArchiveVersion | RENEWAL PREPARED 起必填，与 quote.pin 相等；INITIAL 不补造 |
| `vehicleId`、`assignmentId` | FK Vehicle / VehicleAssignment | 段开始时的实际车辆来源，不表示永远不能在生效后换车。续期准备/激活核当前 assignment 同车同客户。建议 assignment 增 `@@unique([id,orderId,vehicleId])` 并用复合 FK |
| `ownerId` | nullable FK VehicleOwner | RENEWAL 必填，来自真实冻结出租方；历史不能推测缺失值 |
| `listingId`、`productVersionId`、`subscriptionPlanId` | nullable FK VehicleListing/ProductVersion/SubscriptionPlan | RENEWAL 必填，INITIAL 历史来源不存在可空；新列与 snapshot 的冻结 ID 必须一致 |
| `startDate`、`endDate` | Date；上海业务日，[start,end)，end > start | 新段 start 必须等于前段 end；服务端按产品月数算 end |
| `months` | Int，INITIAL 兼容原 1–120，RENEWAL 12–120 | 每段月数，不能用总累计月数替代 |
| `firstPeriodSequence`、`lastPeriodSequence` | Int > 0；last-first+1=months | 从全单已占用月号/段预留范围最大值+1 预留，PREPARED 就固定供未来账单引用；正常首次为前段末号+1，VOIDED 后不复用既有事实号 |
| `snapshot` | Json | 下述 stageSnapshot v1；不可变，来源变化需新报价，不在原段覆盖 |
| `snapshotHash` | 64hex | canonicalHash(snapshot) |
| `scheduledAt`、`activatedAt`、`endedAt`、`voidedAt` | nullable DateTime | recordedAt 事实；实际业务生效日另由 startDate 表达 |
| `createdBy`、`scheduledBy`、`activatedBy`、`voidedBy` | nullable staff FK；续期对应动作必填 | 历史导入不伪造 actor；VOIDED 另需 reason/事件 |
| `createdAt`、`updatedAt` | DateTime | 审计 |

`snapshot` 至少冻结：`version:1`、原/新段 ID 与序号、全局/段内逐期 `billingSchedule`（sequence、stageSequence、日期、dueDate、amount）、完整发布商品/产品版本及 sourceHash、usagePolicy/usagePricing、swapPolicy、lessorSnapshot、revenueRuleSnapshot、原合同/原归档 hash、priorTermsHash、quote commercialHash、assignment 身份、模板/正文 hash、经核实的合作范围及资格依据。事实列用于 FK/检索；Json 不能替代归属验证或真实 FK。

建议索引 / SQL CHECK：

- `@@unique([orderId,sequence])`、`@@unique([id,orderId])`、`@@unique([id,orderId,customerId])`；`@@index([status,startDate])` 用于待激活工作台；`@@index([orderId,status])`。
- 部分唯一索引 `(orderId) WHERE status IN ('PREPARED','SCHEDULED')`，保证最多一个未来已准备段。更早 DRAFT/已确认未归档仍由现有非终结 OrderChange 在订单锁下互斥。
- 部分唯一索引 `(orderId) WHERE status='ACTIVE'`；激活先将上一段 ENDED，再设新段 ACTIVE，整个事务提交后对外可见。
- INITIAL 必须 sequence=1、previous/change/quote为空；RENEWAL 必须 previous/change/quote/archive/商品来源/owner 非空。日期、序号、状态时间和版本范围可做单行 CHECK；相邻日期、source hash、跨表状态在锁内复核。
- 若需要禁止所有历史范围重叠，不依赖 JSON 或应用筛选：主控可加排除约束；最低实现必须在同 Order 锁下验证非 VOIDED 段日期与 sequence 范围不重叠，DB 唯一索引防双未来/双当前。
- 已 VOIDED 的 PREPARED 段不能删。下一次报价的 sequence 范围不得撞已存在 Bill/UsagePeriod/obligation；stageSequence 可跳号，不能修改旧事实消除空洞。

### 2.2 既有模型增量

| 模型 | 最小新增 | 原约束处理 |
| --- | --- | --- |
| `UsagePeriod` | `serviceStageId?` FK (id,orderId)，`stageSequence?` | 保留 `(orderId,sequence)`；新 `(serviceStageId,stageSequence)` 唯一。新续期 period 两者必须非空，pricingSnapshot 与本段一致；原 SETTLED 金额/快照不改 |
| `ServiceObligation` | `serviceStageId?` 同单 FK、`stageSequence?` | 保留 quote+全局 sequence 唯一；未来义务 active=false，生效才 true。先前段 active 义务不批量停用 |
| `Bill` | `serviceStageId?` 同单 FK | 建议续期使用现有 `type='SUBSCRIPTION'`，sequence=全局月号，保留 `(orderId,type,sequence)`；idempotencyKey=`renewal:{quoteId}:{sequence}`。必须由专用 stage/obligation 验证早付范围，不能仅凭 type 放行 |
| `SwapCredit` | `serviceStageId?` 同单 FK | TERM 免费新增唯一 `(serviceStageId,termSequence)`；删除旧 order+termSequence 唯一前先处理遗留 null：旧记录保留部分唯一 `(orderId,termSequence) WHERE serviceStageId IS NULL`。旧 cycle 唯一可保留，续期仅 TERM |
| `SwapCreditPurchase` | `serviceStageId?` 同单同客户 FK | 新购必填；旧记录不补造价格或期限。原 `expiresAt/pricingSnapshot/termsSnapshot/amount` 不变，退款依购买来源而非当前段 |
| `SwapLedger` | 可不加 stage 列，沿 credit/purchase FK 取得；若投影性能要求加可空 FK | sourceKey 新含 stageId；历史 key 不改。reservation/consumption 仍真实 change 唯一 |
| `OrderChangeStatus` | 增 `SCHEDULED` | 仅 SUBSCRIPTION_EXTENSION 使用；此状态非 terminal，直到 activate→APPLIED。也可用 READY+stage.status，但 UI/互斥须一致，建议显式 SCHEDULED |

无需 `Order.currentStageId`：按 orderId/status+日期取唯一当前/未来段，减少多指针漂移。不得拿 `order.effectiveTermsVersionId` 代替未来段标识。

### 2.3 迁移 / 初始段建立

1. 只先加兼容空列和索引，不覆盖任何原 snapshot/hash/金额/付款/有效条款或已结算月。新续期入口仍关闭。
2. 为已真实交车且来源完整的订单建立 INITIAL 段：实际 `UsageAccount.startedOn`、真实 period 范围、原产品/usage/swap；最新条款链只用于当前合同身份及月费安排，不把后续换车目标商品当成原里程/免费额度政策。历史 v1 不补 v2 默认赠送。
3. INITIAL 段不能以今日商品、当前客户资料或虚拟 assignment 补历史。缺少原归属/价格/日期来源的订单保持旧只读路径，续期 eligibility 给出明确人工核对阻断。
4. 可用受控回填命令给旧 period/credit/purchase 关联 INITIAL 段（只写新增 FK）；先输出核验计划/冲突，主控独占 guard DB 审核后执行。SETTLED 原字段与 hash 前后逐项断言不变。
5. 新订单实际交车初始化时同时创建 INITIAL 段。未交付订单不凭预约时间建立已生效段。

## 3. 状态、时点、财务与生效

### 3.1 办理与冻结

`DRAFT → REVIEW_PENDING → REVIEWED → AWAITING_CONFIRMATION → AWAITING_ARCHIVE → AWAITING_FINANCE → SCHEDULED → APPLIED`。

仍复用 OrderChange/DelayQuote/真实 AMENDMENT Contract/ORDER_AMENDMENT 档案。kind=`SUBSCRIPTION_EXTENSION`；q.snapshot.kind 同值。报价财务独立复核；客户确认不依赖新电子签开关。Contract 为 DRAFT/OFFLINE，打印客户已确认的确切正文，不另选模板。

模板采用同一 OFFLINE_ORDER_AMENDMENT 家族的通用 `{{changeFacts}}`，续期 publisher 提供完整 renewal changeFacts（原/新段日期、明确产品版本、旧/新月费与里程、赠送及 paid 原期限、原押金不变、同车同出租方、显式激活条件），并提供 `periodSchedule/financialSchedule`。不为同类型分别启用互不兼容的 delay/swap/renewal 模板；不省略事实来迁就占位符，不自动发布/批准法务。

源变动发生在客户确认前：409→重新预览/新报价。确认后商品下架不倒改已确认纸档内容；使用冻结商品来源并继续核真实性、当前车/出租方、完整链及资格。若资格或范围确已不满足，则阻断准备/激活，不能偷偷替换新商品。

日期固定为上一租期 endDate（不含），新产品 months 算终点。建议只允许到期前办理新报价，且当前期必须仍有合法服务范围；办理窗口先不另加用户未要求的“仅最后 30 天”限制。提前办理多久都不能提前生效；UI 显示确认未来续期后换车受限。

### 3.2 提前账单与可支付范围

- 财务准备之前先验证已确认 q、确切归档、完整原条款链，pin `q.approvedArchiveVersionId`。创建 PREPARED stage、该段逐期义务及 SUBSCRIPTION 账单；保留原月账单/付款/义务，无 carry、无自动退款、无押金重收。
- 每期 dueDate 默认该期 startDate，首期允许客户在纸档+财务准备后主动提前支付；第一版 UI 只开放新段首期提前缴费。后续期正常按已有账单策略进入可支付范围，不能误以未到日期就是已逾期。
- `ServiceObligation.active=false` 只表示尚未成为当前服务范围，不能用它否认明确批准的未来首期支付。支付门禁单独核 bill→stage→quote→pin→真实 agreement，拒绝原价/范围不符及错客户；当前段既有账单仍可照常支付。
- 新段首期净真实到账全额、原押金仍满足、无相关未决收退款或 reconciliation、纸档及资格齐备后，财务显式 schedule。不是要求一次付完 12–120 个月；“未付清”指本次应核清的首期/原义务/已发生差额，不把未来正常月费全部当欠款。
- `schedule` 不写新 OrderTermsVersion、不延长原付费换车次数、不创建可用新赠送、不更改当前有效费率。
- 可信迟到回调必须记真实 SUCCEEDED；如 pin/资格/状态已不满足，仅进入 reconciliation 或待人工处理，不能吞款、自动激活或按新政策补造权益。原 payment/refund 当前授权与二人复核保留。

### 3.3 显式 activate

运营/ADMIN 在上海 `today >= stage.startDate` 后操作；无自动支付、签章或后台隐式 GET 激活。先展示完整阻断/财务和待生效摘要，POST 带当前 order/account/stage/assignment 来源及 previewHash/key。

同事务：当前授权 → 幂等命令锁 → Order → UsageAccount → 相关 Vehicle（ID 排序）/真实 assignment → Stage/Change/Quote → periods/obligations/credit。与 swap/return 共用 Order 首锁，源单行锁次序按既有约定复核，不能形成反向锁。重读所有状态及 CAS，不使用事务外缓存决定写入。

激活复核：SCHEDULED、startDate 到达、前段仍唯一上段、当前 assignment/vehicle/owner 与冻结来源一致、无实际归还/订单结束/其他变更、原及新增归档 pin 当前有效、财务满足、合作范围覆盖新增租期、保险与资格在实际激活时点有效。不得仅按之前的 schedule 成功放行。

事务写入：

1. 新 OrderTermsVersion 接当前原链头，snapshot 记录本段服务范围/价格/商品/usage/swap 和上段引用，hash=q.commercialHash，offlineArchiveVersionId=同 pin；更新 effectiveTermsVersionId。原条款及 RENTAL 完全不改。
2. 旧段 ENDED、新段 ACTIVE；`activatedAt` 是真实操作时刻，合同 `effectiveAt` 为已确认 startDate 上海零点。允许起始日后补做该已确认续期的激活，但必须保留晚办理时刻及阻断历史，不造那几日的读数/服务事实。
3. 仅追加本段 global sequence 的 UsagePeriod 和同实际 assignment 的 UsageSegment；零/空起始读数按既有真实段规则，不发新交接任务。新月价格来自本段，旧未结算月仍按原段结算。
4. 只把本段 obligations 置 active；保留旧期未结清事实，不 updateMany 停用整单。FREE 的可用范围按本段起止日判定并采用本段唯一键；旧段免费到期不结转。
5. change→APPLIED，记录命令/审计；重放同键同体返回同结果，跨 session/撤权先拒绝。

没有激活时的范围处理：旧期 endDate 到达后，“当前段”解析不得回退旧段价/赠送；新的用量月结、附加里程/换车次数购买、换车、新期权益使用均返回明确 `SERVICE_STAGE_ACTIVATION_REQUIRED` 或对应未就绪原因。旧已发生月的核对/结算、旧合法账单付款、真实回调和历史查询继续。车辆仍真实占用，不自动完成订单或伪造归还。若确需在未激活状态归还，只能走既有人工异常/终止核查并真实记录实车事实，不能虚构一段收费；此异常收车路径必须在启用前有明确可操作入口或明确转人工阻断说明。

### 3.4 取消与已准备资金

确认前允许按原报价取消/拒绝。确认/归档后不能删除 stage 或改原正文；已准备账单的撤销需专用撤销预览，保留纸档与 before/after，逐笔真实核清付款/退款/未知结果。最低首版仅允许“全部未来账单未支付、无支付进行中/退款/对账、经明确人工确认撤销”的 VOID；已有真实收款禁止快捷撤销，必须现有退款二审及补充协议终止处理后再核清，不自动退款。

任何已确认未来段未正式撤销前阻断后续换车及会破坏未来来源的提前结束；若提前结束必须办理，先完成未来续期撤销的事实/资金闭环，不能留一个永不可用的有款 stage。此撤销处理是启用前验收项，不以占位按钮代替。

#### 2026-10-31 用户追加确认与取消实施边界

用户已明确确认：双方同意取消尚未开始的续期时，新增续期实收全额退还，不收取消费；退款由财务独立复核，保留取消协议和原合同记录。本确认不等于退款已完成，不授权自动发起真实渠道退款测试，也不把新租期开始后的实际使用按零费用撤销。

- 专用取消处理同一真实 order/customer/change/quote；服务段可空，涵盖已确认但尚未准备账单的 AWAITING_ARCHIVE；已有段只允许 PREPARED/SCHEDULED，必须上海当前日期早于新段起始日。ACTIVE/ENDED 或已到起始日不走“未开始续期全退”。
- 新实体 `OrderRenewalCancellation` 持有 sourceSnapshot/hash、revision、OPEN/COMPLETED；签署状态 UNKNOWN/UNSIGNED/SIGNED，明确人工证据与操作者。UNSIGNED 必须核查所有历史上传/退回/失效纸档均无签字事实，不能仅因无当前 pin 就当未签。SIGNED 使用独立 `RENEWAL_CANCELLATION` / `ORDER_RENEWAL_CANCELLATION` 纸档，与整单 TERMINATION 及原 ORDER_AMENDMENT 分开。
- 018 仅新增结构：可空 stage 的完整同源 FK、独立取消档案/版本/哈希 pin 组、完成事实/哈希/人员时间；Refund 新四个全空或全满的来源列，通过真实 Payment、Bill、Cancellation 复合 FK 绑定同客户同订单同服务段。旧资金/纸档全 NULL 路径原样保留。数据库约束不能替代运行时资金与签署核验。
- OPEN 仅暂停本次未来续期继续 prepare/schedule/activate/新支付；原期合法账单照常。已在渠道的迟到实收必须保留 SUCCEEDED 并进入核对，不因取消吞掉事实，也不继续分配未来服务义务。
- 专用退款 request 按本次新段各笔已核实 SUCCEEDED 实收扣除真实已成功退款计算剩余应退，不收取消费、不碰原押金/原期实收；只生成 PENDING_APPROVAL。继续沿用现有独立财务 approve、retry、sync 与可信渠道回调。CREATING/PENDING/UNKNOWN 付款、进行中退款或未结对账均阻止最终完成；仅“已申请退款”不是归零。
- 最终同订单锁内再次核清最新来源、签署、全部新段账单、每笔实收/成功退款及异常款 REFUNDED 核对；保留原 quote/正文/档案，取消 change，已有未来 stage VOIDED，只撤未付未来应收并释放本段分配；不改原段、实际车辆分配、旧价、原押金或历史里程，不复用已经占用的全局月号。

## 4. 专用 API 与 source 契约

建议独立 `order-renewals` 模块，不把 shared delay/swap 文件变成相互分叉的大服务；公共 agreement/readers 最小扩展由原 owner 或主控实施。

| 方法 / 路径建议 | 作用 / 输入 |
| --- | --- |
| GET `/admin/orders/:id/renewal-context` | 当前/未来 stage、assignment 可读身份、有效链头、order/account revision、可办理能力及阻断；当前与未来费用分开 |
| GET `/admin/orders/:id/renewal-goods?keyword&page&pageSize` | 仅真实当前车可用于续期的 PUBLISHED/visible 商品，最小产品版本/月费/里程/TERM，真实分页；不套空闲车条件 |
| POST `/admin/orders/:id/renewals/preview` | `{listingId,listingRevision,productVersionId,orderRevision,accountRevision,reason}`；只读返回 sourceHash/previewHash、起止/全局序号、逐期金额和政策差异 |
| POST `/admin/orders/:id/renewals` | 上述冻结来源+previewHash+idempotencyKey；建立 kind SUBSCRIPTION_EXTENSION change，revision 0 |
| POST `/admin/order-renewals/:id/quotes` / review / publish | 独立财务复核和已启用真实法务模板；沿用明确权限/不能自己复核；任何正文变动新 quote |
| 客户 GET change / POST confirm、reject | 原客户归属；明确续期范围和旧期不改；confirm 用 quote.id/revision/commercialHash/bodyHash；真实旧会话清除 |
| 既有 `/admin/offline-archives` | ORDER_AMENDMENT，subject ORDER_CHANGE_QUOTE，subjectId=q.id，quoteId 真 FK；固定模板/正文、上传、审核、显式归档；不假 SIGNED |
| POST `/:id/finance/prepare`、`/:id/schedule` | FINANCE/ADMIN；pin、PREPARED 与首期资金核清后 SCHEDULED；金额不可输入覆盖 |
| GET `/:id/activation-preview`、POST `/:id/activate` | ADMIN/OPERATIONS；current revision/hash，生效日后显式办理；只读预览不写库 |
| GET `/:id/cancellation-preview`、POST `/:id/cancel-prepared` | 按 3.4 最小撤销资金/纸档门禁；必须真实 actor/reason/revision/key，不能取消已 ACTIVE 历史 |
| GET `/admin/orders/:id/service-stages` 及客户同单只读投影 | 完整历史、当前和未来分别展示；不给客户/合作商/FIELD 内部审核/成本或私有证据 |

stage source 必须冻结版本和 hash，不能只存 listingId 再读当前商品。激活绑定独立当前车辆/订单版本，不能误拿 stage.revision 当 vehicle.revision。未知响应客户端冻结原 key/body；成功写入后 GET 失败仅回读，409 留输入且必须重取来源/重预览。

权限建议：复用 order-changes 的当前读写边界或主控新 `order-renewals.read/write/review/finance/activate` 精确权限；OPERATIONS 不能读取财务私有字段/执行 schedule，FINANCE 能核账但不能替客户确认或运营激活，FIELD/SUPPORT/合作商不因续期获得办理权。无论采用哪种权限命名，先当前 staff 校验再幂等旧 key。

## 5. 必须共用的读取函数

建议新增 `order-service-stages/{types,source,readiness}.ts`，导出严格纯/读 helper，禁止 GET 建段或隐式激活：

- `readServiceStageAt(tx,orderId,shanghaiDay)`：只返回已 ACTIVE/历史 ENDED 且日期包含该日的真实段；未来 SCHEDULED 不算当前。未知/缺口明确阻断。
- `requirePeriodPricing(tx,order,account,period)`：period.stage FK+全局/段内序号+完整 frozen pricing。旧无 stage 路径严格保留原 v1/v2 校验；不按今日费率计算历史。
- `readStageSwapPolicy(tx,stage)` / `readPurchaseSwapSource(tx,purchase)`：免费额度按 stage；付费退款和到期按购买原来源。不得以当前新政策否认原有效 paid credit。
- `readOrderServiceSchedule(tx,orderId,{includeFuture})`：聚合真实 stage/obligation/Bill，保留 sequence；用于资金、客户、最终结算、合作商收入。未来项带状态，不能误计当前已履约收益。
- `requireRenewalSource(tx,change,quote,stage?)`：同客户/车/出租方、来源 ID/hash、原链/quote/pin/模板/双方，准备及激活均重新核验。

`effectiveTerms()` 仍表示当前生效补充协议；不要把它变成“最新 future quote”。主合同详情仍原 RENTAL，历次 AMENDMENT 各自 frozen 内容，当前运营摘要才引用当前 stage。

## 6. 四入口最小完整展示

1. **PC：** 原订单“续期”专用入口；真实同车商品分页选择；旧/新期间、产品版本、月费、里程及赠送对比；客户确认→纸档→资金→待激活/阻断→显式生效时间线。财务看到原账单与新增账单而非一笔混合差额。到期未激活进入待办。没有通用改价控件。
2. **客户小程序真实版：** 保持原页面视觉，在 orderchanges/record 现有分支区分续期；显示“当前租期”“已确认未来租期”，未激活不改首页当前月费/里程/赠送。确认/拒绝独立于 eSign；未来首期账单主动支付、真实纸档可读；未知结果仅核对，不能重复确认/付款。
3. **合作商 H5：** 仍是当前合作身份白名单，只读本人车辆/协议/结算允许字段；续期纸档范围和新增租期摘要来自专用 projection，不读取客户身份证/人工资格/内部费用。收益只来自真实付款和冻结规则，不因 SCHEDULED 直接记收益。不新建电子签任务。
4. **FIELD：** 连续同车续期不产生 DELIVERY/RETURN/SWAP 任务；已有真实任务历史不改。将来真正换车/归还任务按当前 terms/stage+实际 assignment 冻结来源；只当前指派 FIELD 可读写本任务。续期期间的任何资格/金额变化不扩大 FIELD 读取。

## 7. 分阶段实施与重要红测

所有 task 先纯红→绿、再类型检查；需要真实 DB 的 task 在主控独占 guard 窗口排队，禁止直接导入 Db 的测试当作纯测跑。实际前端使用 loopback 合成数据并保留 1440/390 截图。各包独立 before/final/manifest/diff，不覆盖旧封存证据。

### Task 1 — 主控冻结结构与兼容 migration

Files：`apps/api/prisma/schema.prisma`、主控下一序号 migration、`apps/api/test/order-service-stage-schema.test.ts`、受控 fresh-schema hook；可新增 `order-service-stages/types.ts`。

- [ ] 先红：同单/同客户 FK、双未来/双当前、跨单 previous/quote/assignment、无源 RENEWAL、反向日期/序号、旧 null 兼容、初始 TERM 与续期 TERM 同 ordinal 可共存。
- [ ] 冻结第 2 节字段、索引和状态；validate/generate 由主控执行。
- [ ] guard fresh schema 全链迁移；断言旧账单/SETTLED/pricing/hash 原值不改。没有可验证真实来源不回填。

### Task 2 — stage resolver 与原期间保护

Files：新增 `apps/api/src/order-service-stages/{types,source,readiness,initial}.ts`；限定 `usage/{pricing,rules,usage.service,ledger,returns}.ts`、`vehicle-changes/{assignments,segments}.ts`；新 `test/order-service-stage-pricing.test.ts`、`renewal-segments.test.ts`。

- [ ] 红：旧 1500/150 和 v2 原价仍可核；新期不同基数/超额单价仅作用新期；新 stage 生效后旧未结算月仍原价；错误/跨单 stage 拒绝。
- [ ] 红：120+12 产生 121–132，不碰 1–120 的 SETTLED；voidUnpaidQuotes 使用真实末期；取消号不复用，实际上一月查询不要求 sequence-1 存在；时间连续/真实前月已结算仍强校验。
- [ ] 红：相邻月底/闰年/上海日界线，无重叠/漏日；同 assignment 无新交接/无假里程，跨月首读来自上一真实段。
- [ ] 原 v1/v2/returns/segments 对应纯回归，guard 真实追加及末期归还单独排队。

### Task 3 — 续期报价、真实商品与纸档

Files：新增 `apps/api/src/order-renewals/{types,context,quotes,offline-publish,controller,service}.ts`；公共 `products/snapshot.ts` 仅必要导出；原 owner 最小扩 `order-changes/{agreement-facts,agreement-readiness}.ts`、`offline-documents/{amendment-context,schemas,archive.service,print}.ts`；新 `test/order-renewal-source.test.ts`、`order-renewal-paper.test.ts`。

- [ ] 红：真实 IN_USE 本车成功、别单占车/无当前 assignment/已归还/异出租方拒绝；商品分页后第 101 个仍可选；明确 PUBLISHED 版本与 hash 不符 409。
- [ ] 红：只服务端产品月数/金额，客户端多传金额拒绝；旧期间字段与总账户快照 byte-for-byte 不变；客户确认时 hash/version/期限及当前归属正确。
- [ ] 红：未来已确认续期阻断新 swap；已有未完成 swap 阻断续期；第二个未来段并发只成功一个。
- [ ] 法务仅用户已正式发布的 OFFLINE_ORDER_AMENDMENT 续期适配模板；缺占位符来源拒绝，不自行编写/启用条款。确切正文、模板、quote/Contract/归档闭环。

### Task 4 — 提前资金与显式激活

Files：新增 `order-renewals/{finance,activation,cancellation}.ts`；限定 `order-changes/{finance,context,obligations}.ts`、`billing/{billing,reconciliation}.ts`、`offline-documents/readiness.ts`；新 `test/order-renewal-finance.test.ts`、`order-renewal-activation.test.ts`、`offline-order-renewal-db.test.ts`。

- [ ] 红：PREPARED 先建未来首期账单可早付、当前月仍可付；错 stage/quote/pin/bill 拒绝；不把提前收款计为当前服务已履约。
- [ ] 红：未全额首期不能 schedule；schedule 不改有效指针/费率/赠送；前一天 activate 拒绝，起始日及以后显式激活成功。
- [ ] 红：重放同 key/body 无重复账单/period/terms，当前撤权旧 key 仍拒；activate 与 swap/return/撤销并发只一方成立；失败事务无半段。
- [ ] 红：档案更正/失效、priorTerms 漂移、合作范围/保险变化、已退款或未知支付阻断；真实迟到款仍 SUCCEEDED+reconciliation，不吞款不自动生效。
- [ ] 红：到期未确认/未付清/未激活没有新价/新 gift fallback；旧事实可结算；未收款未来撤销不删历史，有款不得快捷取消。
- [ ] guard 真 HTTP：create→quote→复核→publish→客户 confirm→真实 archive create/prepare/print/upload/review/archive→finance prepare→真实合成已验证支付流程→schedule→到期 activate→月结→真实最终归还。不可手改 ARCHIVED/PAID 代替被验流程；时钟用注入 fixture。

### Task 5 — TERM/付费次数、全单账款与结束/合作读取

Files：限定 `swap-purchases/{policy,rules,ledger,controller,view}.ts`、`vehicle-changes/{credits,account,offline-account,quotes,service}.ts`；`orders/{customer,customer-order-view,readiness,business-gates,order-process-facts}.ts`、`partners/{simple-revenue,settlements}.ts`、`offline-documents/{termination,workspace.service,workspace-facts}.ts`；新 `test/renewal-swap-credit.test.ts`、`renewal-end-and-revenue.test.ts`。

- [ ] 红：第 1 段剩余 FREE 到期不结转，第 2 段 includedCount 可为 0；两段 ordinal=1 不冲突；未来不发放，原消费不清空。
- [ ] 红：原 paid expiresAt/退款价 v1 80000 或 v2 原动态价原样；新段额外费变化不改旧 purchase；逐笔过期不伤新段。
- [ ] 红：新段月费/里程出现在当前摘要，原合同原期间仍原值；新段全局月号与旧 adjustment bill 发行号不混淆。
- [ ] 红：续期后末期真实归还可结算；原期与新期付款按各自来源计收益，无来源/未确认/未来 SCHEDULED 不造结算；已确认未来段提前结束必须先解决未来协议/资金。

### Task 6 — 四入口与门禁验收

Files：PC 新 `apps/admin/src/renewals{,-model,-ui}.ts(x)` 与必要 styles/tests，主控注册 App/nav；真实小程序 `services/order-changes.js`、`pages/record/index.js/index.wxml` 的续期分支及相关当前用量/换车摘要；合作商 `apps/signing-h5/src/owner/{workspace,OfflineWorkspace,PartnerSettlements,partner-model}` 及只读 tests；FIELD `apps/admin/src/field` 与 `apps/api/src/field-handover/{batches,task-context}` 仅来源读取/回归，无自动建任务。

- [ ] 实际组件红：当前/未来分开、商品真分页、finance/ops 边界、当次失权清私有、409 保输入且必须新预览、unknown 原 key/body、成功写后 GET 500 仅 GET 恢复、StrictMode 两次 effect 正常。
- [ ] 小程序保留原视觉、白名单 mode/bodyHash/quote 关联，首期真账单入口，不开放电子签按钮。
- [ ] H5 跨合作商/客户/原材料不泄漏；FIELD 非本人任务拒绝、续期不伪造交接。
- [ ] 1440/390 真实合成截图、相应完整构建、受影响纯回归及主控授权 guard E2E 全链；独立复审完再由主控有限解除门禁。未完成链继续关闭。

## 8. 主控冻结项与有限范围

已由主控接受：一个订单/账户/真实 assignment；stage 冻结商品、usage、swap、已归档 quote；一份未来段；同车同出租方；已确认未来段阻断换车；paid 原期限；原 snapshot 不覆盖；SCHEDULED 之后运营到期显式激活，不自动支付/签章。以下不需要再次向用户询问已确认事项，只须主控在 schema/API 开工前固定：

| 项目 | 本计划建议默认 / 原因 |
| --- | --- |
| 月号与未来账单 | 全局月号在 PREPARED 固定；Bill 复用 SUBSCRIPTION + stage FK，第一期可早付，后续按正常到期策略；避免增加资金类型同时仍可正确做 reconciliation |
| 状态与时间 | stage PREPARED/SCHEDULED/ACTIVE/ENDED/VOIDED；change 加 SCHEDULED；不提前生成 OrderTermsVersion。真正操作时间与已确认生效日分别记录，晚激活不造历史用量 |
| 办理窗口 | 不新增“仅 30 天”限制；要求原期未结束时形成客户确认。到期后新起一个已过期报价属于补历史合同，本首版不自动支持；已提前确认的续期可在事实仍满足时延后显式激活 |
| 通用 COUNT benefits | 本次只明确 TERM 赠送重置。DESCRIPTION 可随新段呈现；不得重新调用原交付激活给旧 COUNT 翻倍。首版若新商品含尚无 stage 语义的通用 COUNT，明确 eligibility 阻断并列出该组件，待独立规则/模型包，不假称已支持 |
| 额外购买里程包 | 与产品包含的月里程不同。现有真实 ledger 是全账户、真正退订才过期；本包保留原冻结条款与真实余额，不擅自新定到期/退款/清零，也不复活已过期项。若某历史文书给明确原期截止日，则按原证据阻断并人工核对，不能用当前代码猜延长 |
| 合作/收益 | 新段冻结同出租方、覆盖完整新增租期的真实合作依据及约定分成；不静默用今日分成改旧月。若原合作条款不足以支持新期或分成变化尚未正式确认，续期准备阻断，先走已有合作管理流程 |
| 保险 | coverage 当前仅时点能力。办理时给当前及已知续期起日检查/到期提醒，激活再核当时真实保障；不声称一张年度保单覆盖 12–120 个月。若要求全期预先覆盖则会普遍阻断长产品，需要另立保障续保策略，首版不擅自承诺 |
| 有款未来撤销 / 未激活真实收车 | 必须给现有人工退款二审/终止核查可操作关联；本包不自动违约计费、不吞迟到款、不把事实收车当 stage 激活。若最小链无法提供可信处理入口，门禁仍关闭，不能仅上线顺利路径 |

本轮交付仅计划和来源证据。以上未勾选 task 都未实施；已存在的延期/换车功能和法务/总门禁保持各自当前状态。


#### 2026-10-31 补充确认：期前约定跨起租日办理

用户确认：双方在新增租期开始前已同意取消，即使退款或纸质归档跨过起租日，仍全额退还新增续期实收、不收取消费，续期不生效。系统分别保留真实双方同意时间、运营核实时间、证据清单和来源哈希。OPEN 创建时间、原续期签署、退款发起均不替代双方同意。允许运营在起租后凭真实期前证据补录，原确认不可静默覆盖；新期已经生效或产生使用记录则不适用此流程。退款申请和最终取消均须先显式核实双方约定，不能仅凭未签声明。

#### 2026-10-31 执行状态更新

上方“本轮交付仅计划/未实施”和未勾选任务是初始计划时点记录，不再代表当前实现状态。续期来源/报价/纸档/资金准备/排期/激活、阶段权益及里程、换车后最终归还、期前取消及完成后迟到真款退款、四入口安全投影均已有实现与分阶段验收。正式createApp已注册续期controller/service；真实本地HTTP取消全链与续期换车最终归还全链分别1/1零skip通过，独立复核记录见 docs/evidence/ninda-admin-rebuild-20261031.md 后续各节。

尚未宣布整版上线：四份正式文本待逐项用户批准，最终整包冻结/构建与生产preserve发布、真实入口/微信真机/提审发布仍需完成。已有合成支付和签署证据不等于真实渠道验收。实施证据按各阶段具体来源和时间阅读，不将重叠测试数量相加。
