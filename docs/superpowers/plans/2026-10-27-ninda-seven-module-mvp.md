# 宁达七模块 MVP Implementation Plan

> **2026-10-28最新调整：** 用户已确认[合作商运营维护与只读查看v2.2基线](../specs/2026-10-28-partner-operations-readonly-design.md)。当前新增实施任务见[R1–R6开发计划](2026-10-28-partner-operations-readonly.md)，均待实施。下文N01–N11是v2.1历史工作及验收记录，不能用其勾选状态代表新改造完成。合作商不再要求小程序客户绑定；运营统一办理合作及结算、保留经办/复核分权；服务号合作商入口改为独立手机号授权只读。旧计划中身份候选、H5反馈写入及固定FINANCE门禁由新计划替代。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按车辆、客户、合作商、保单、产品、订单、合同七模块组织后台，并使客户小程序、企业/个人合作商 H5、后台及 FIELD 完成线下签约、线上履约与人工合作商结算。

**Architecture:** 沿用模块化单体，在 v2 线下档案和交易流程上增量建设主体准入、保单、产品版本/权益及分润台账。订单聚合事实，合同/保单/结算各有唯一数据源；各端读取专用权限投影。

**Tech Stack:** Node.js `>=22 <25`、`pnpm@11.7.0`、NestJS/TypeScript、Prisma/PostgreSQL、React/Vite、微信原生小程序、node:test。

**Spec:** [七模块总基线（已合并v2.2修订）](../specs/2026-10-27-ninda-seven-module-mvp-design.md)，合作相关以[v2.2专项基线](../specs/2026-10-28-partner-operations-readonly-design.md)优先，并继承 [v2.0线下细则](../specs/2026-10-26-ninda-offline-contract-mvp-design.md)的不冲突要求。

日期：2026-10-27，进度更新至2026-10-28。版本：2.1。用户已确认，N01–N11本地开发验收完成，API v7和后台合作商指引版已部署；首批3辆车、2款产品已发布，合作商准入与保单审核仍待实际办理。小程序1.1.5体验切换及设置/返回位置已获用户确认，完整真实业务验收与微信正式发布仍待完成。实际进度见[生产发布记录](../../evidence/ninda-seven-module-release.md)和[首批产品记录](../../evidence/ninda-product-intake-20261027.md)。本文件是总排期入口，[旧计划 O01–O14](2026-10-26-ninda-offline-contract-mvp.md)是复用的细化任务，不重复施工。先读AGENTS.md、原始独立平台设计、当前API契约及本次用户要求；代码工作树已有其他线程变更，开工前按文件核对归属。

## Global Constraints

- 仅在本项目写入。旧仓库和旧数据库作为只读来源；禁止连接旧业务库做开发测试。
- 金额整数分；客户归属、后台 RBAC、版本冲突、事务幂等、支付回调校验不可省略。历史签署回调仍须验签和绑定原任务。
- 小程序原样副本不改写；真实版保持页面视觉，生产不回退 Mock。
- 法大大历史结构复用来源提交 `453da778dcfefd3727813179382490903644ef26`；本版不新增电子签执行，不读取落后的旧工作树替代历史来源。
- 密钥禁止输出/入 Git/入前端。真实支付、退款及历史签署处理需明确操作范围；本轮不执行。
- 并行人员只写分配目录；根安装、锁文件、schema、迁移、鉴权与应用注册由主控统一处理。不单独提交别人文件、不推送、不部署旧系统。
- 重要业务行为先测试，再实现和核验。采用现有 NestJS、Prisma/PostgreSQL、React/Vite、原生小程序，不引入新中间件。
- Node.js 为 `>=22 <25`，包管理器为 `pnpm@11.7.0`；依赖保持项目已锁定版本。
- 时间存储 ISO8601，业务日期与展示使用 Asia/Shanghai；分转元仅用于展示。
- 测试库仅本项目本地 loopback:55432/chundian_test；同一时刻一个 API 测试进程，不输出连接串。

## Review Focus

1. 企业与个人共用手机号却无当前合作关系：所有列表/文件/动作拒绝串号访问，N02/N09。
2. 客户确认时产品已改版、车辆已占用、资料/风控已变化：原子重验并返回可解释冲突，不创建半单，N03/N04/N07。
3. 多保单、批改/退保或跨零点到期：按车辆与实际交付时刻检查保障，不取消已发生的履约，N05/N07。
4. 分润单复用同一收款来源、退款发生在已付之后、编制人自审：拒绝重复/自审，追加调整而不改旧实付，N06。
5. 两名员工同时受理最后一次权益、取消重试及旧文本权益：次数不透支/不重复返还，说明型不产生虚假余额，N08。

## 1. 现状与新增目录责任

已有 `VehicleOwner` 仅企业，`SubscriptionPlan` 逐车存储且 `benefits` 是文案，`Entitlement` 无数量流水，保险只有合同文字。七模块不是已上线能力；不得以导航改名宣告领域完成。

| 负责人边界 | 主要文件/目录 | 责任 |
| --- | --- | --- |
| 主控 | `apps/api/prisma/schema.prisma`、迁移目录、`apps/api/src/app.ts`、`auth/access.ts`、根依赖/锁文件 | 集成模型、唯一约束、注册、权限与迁移，不交给并行者共同编辑 |
| 合作商 | 新 `apps/api/src/partners/`，现有 `owner-signing/owner.service.ts`、`owner-h5/` | 主体类型、准入、有效关系、分润规则及人工结算 |
| 客户 | 新 `apps/api/src/customers/qualifications.ts`、`applications/risk-review.ts` | 资料与本次申请审核，复用信用授权 |
| 产品 | 新 `apps/api/src/products/`，现有 `catalog/catalog.ts` | 产品/权益定义版本、可售投影 |
| 保单 | 新 `apps/api/src/insurance/` | 保险材料、保障要求、到期判断与续保待办 |
| 权益履约 | 新 `apps/api/src/entitlements/`，现有 `operations/workflows.ts` | 订单权益授予、预占、使用、冲正 |
| 三端 | `apps/admin/src/`、`apps/signing-h5/src/owner/`、`apps/miniprogram/src/` | 角色界面及安全 DTO；不得用前端状态代替后端门禁 |

以下 Create 文件在开工时若已由其他任务建立，应先核验后增量修改，不覆盖。迁移名称由主控生成新的唯一时间戳。共享入口文件按任务串行合并，单一测试库禁止并发测试。

## 2. 与旧 O01–O14 的关系及执行顺序

| 原任务 | 本轮处理 |
| --- | --- |
| O01/O02/O04/O12 | 保留：模式、安全测试入口、人员权限、档案基础、禁止新电子签 |
| O03 | 企业专用核验部分由 N02 替换；出租方快照与线下打印仍执行，适配企业/个人，依赖 N02/N04；分润规则到最终订单的冻结在 N07 集成 |
| O05 | 保留档案复核/反馈；配合 N02 的企业/个人关系授权，不再使用企业证书判定 OFFLINE 权限；财务文件测试增加已归档合作协议可读、客户/租赁/交还车材料仍拒绝的限定分支 |
| O06/O07/O08 | 保留资金、查验交还、取消退款；N07 接入新增风控/产品/合作资格/保单条件 |
| O09/O10/O11 | 既有线下 UI 要求合并到 N09/N10 完成，不再按旧导航另做一套 |
| O13/O14 | 与 N11 合并验收和发布；包含本轮新模块，不重复进行真实交易验收 |

明确依赖（覆盖旧计划与上述任务冲突的顺序）：

1. O01 → O02/O04/O12；O01 → N01。
2. N01 + O02 + O04 → N02；N01 + O02 → N03/N04/N05。
3. N02 + N04 → O03（只执行扩展后的快照/打印部分）；O03 + O04 → O05。
4. N02 + O05 → N06（规则引用已归档合作协议，财务读权限在 O05 就绪）；O05 → O06 → O07 → O08，继承旧任务的相关附加依赖。
5. N02/N03/N04/N05/N06 + O06/O07/O08 → N07；N04 + O07 → N08。
6. N07/N08 + O02/O05/O12 → N09/N10；N09/N10 → N11，并合并 O13/O14。

N02–N06 可按目录分工，但 schema/迁移/注册和共享文件由主控串行集成。所有中间领域任务有独立验收，未接入 N07 的新能力不得开放生产业务入口。

## 3. 公共接口与返回约定

N01 在 `apps/api/src/mvp-domain-types.ts` 定义：`SubjectType='ENTERPRISE'|'INDIVIDUAL'`，`CommandContext={actorId,role,idempotencyKey}`，`VersionedInput={revision:number}`，`GateResult={ready:boolean,blockers:{code,label,resourceType,resourceId}[]}`；`tx` 为项目 Prisma 事务客户端，领域服务接收同一个事务，不自行开启彼此不一致的事务。

所有金额字段名 `*Amount` 且整数分；费率 `rateBps` 为 0–10000 整数，仅用于约定记录，不自动计算实付。规则为比例/固定月额/其他约定时，分别要求费率+基数说明、金额+月份口径、完整约定文本。写端点对缺字段、无权限、失效版本分别返回既有格式的 400/403/409；资源跨归属不得通过错误消息泄露其详情。

业务字段 DTO 在所属目录 `types.ts` 逐项定义，并同步 `docs/api-contract.md` / `docs/api-owner-h5.md`；不用 `any` 或大段任意 JSON 代替身份、保单、产品、结算结构。冻结快照允许 JSON，但必须有 schemaVersion 和验证器。

## 4. 任务清单

### N01：七模块契约与领域类型

**Files:** 修改 `docs/api-contract.md`、`docs/api-owner-h5.md`；新增 `apps/api/src/mvp-domain-types.ts`、`docs/fixtures/seven-module-mvp/{enterprise,individual,customer,field,finance}.json`；测试 `apps/api/test/seven-module-contract.test.ts`。

**Interfaces:** 公共类型见第 3 节；定义七个模块 ID `vehicles/customers/partners/insurance/products/orders/contracts`。文档端点固定 v2.1 基线第 7 节的路径；具体命令后缀为 `/submit`、`/review`、`/record-payment`、`/reconcile-payment` 等，读写 DTO 不混用。

- [x] 写契约测试：个人没有 creditCode、分润比例不进客户 DTO、保险无配置时返回 blocker、金额 1 分/0 分与超界 bps 校验，全部 fixture 使用合成人名和证件标识。
- [x] 运行 `node scripts/run-mvp-api-tests.mjs test/seven-module-contract.test.ts`，确认新契约预期失败；此安全入口由 O01 完成后才可使用。
- [x] 实现公共类型/验证器并补充两份 API 契约，区分已实施和待实施部分；文件下载权限/分页/版本/幂等规范一并定义。
- [x] 重跑上述命令及 `pnpm --filter @chundian/api build`，通过后记录契约版本与域负责人。

### N02：企业/个人合作商准入及车辆归属

**Files:** 新增 `apps/api/src/partners/{types,admission,identity,vehicle-binding,controller}.ts`；修改 `owner-signing/owner.service.ts`、`owner-h5/{access,legal-representative,service,auth.controller}.ts`、`operations/admin.ts`；主控修改 schema/迁移/权限；测试 `apps/api/test/partner-admission.test.ts`、`partner-identity-isolation.test.ts`。

**Interfaces:** `PartnerAdmissionService.review(tx,ctx,ownerId,input):Promise<PartnerVerificationView>`；`PartnerIdentityService.requireSubject(tx,session,ownerId):Promise<PartnerIdentityBinding>`；`VehicleBindingService.rebind(tx,ctx,vehicleId,input):Promise<VehicleBindingView>`。企业/个人条件字段按基线，不为个人调用企业证书检查。

- [x] 写并运行两项测试：企业无信用代码拒绝、个人无信用代码正常建档、个人证件不能落 creditCode、同手机号客户/合作商越权拒绝、关系撤销使旧会话失效、资料改变需重审、上传/提交人自审拒绝。
- [x] 增补车辆测试：有占车/未结束订单时换出租方返回 409；同车有效绑定唯一；历史快照不随资料变化；旧直接 bindVehicle 标 APPROVED 入口不能绕过独立核验。
- [x] 实现条件字段与身份关系、准入审核、车辆版本关系及既有企业兼容迁移；不自动把历史资料视为新人工审核通过。合作协议/规则是否就绪在 N07 统一计算。
- [x] 运行 `node scripts/run-mvp-api-tests.mjs test/partner-admission.test.ts test/partner-identity-isolation.test.ts test/owner-h5-auth.test.ts` 与 API build，通过后进入 O03；N06 另等待 O05 的归档和文件权限。

### N03：客户资格及本申请风险审核

**Files:** 新增 `apps/api/src/customers/{types,qualifications,controller}.ts`、`apps/api/src/applications/risk-review.ts`；修改 `applications/{applications,credit-review}.ts`、权限与 schema；测试 `apps/api/test/customer-risk-review.test.ts`。

**Interfaces:** `QualificationService.review(tx,ctx,customerId,input):Promise<CustomerQualificationView>`；`RiskReviewService.assess(tx,ctx,applicationId,input):Promise<RiskReviewView>`；`requireCurrentRisk(tx,applicationId,planRevision):Promise<RiskSnapshot>`。结论绑定资料、信用授权/核验和方案版本，原因采用结构化码。

- [x] 写并运行测试：上一单通过不能用于本申请；授权撤回、资格到期、资料/车辆/条款变化导致原审核不适用；NEEDS_INFO 不能确认；客户投影不出现核验明细；拒收精确分数/信用截图字段。
- [x] 实现资格版本及本申请审核，不改变原信用档位/押金规则。新方案先生成候选版本，审核通过后才可发布待客户确认；再改方案生成新候选，不在已审核版本上回写。
- [x] 实现客户安全结论和补件项投影，客服只得状态，财务/FIELD/合作商无风险明细；封堵旧通用资源读取路径。
- [x] 运行 `node scripts/run-mvp-api-tests.mjs test/customer-risk-review.test.ts` 及相关现有 credit 测试，通过后交给 N07 集成。

### N04：产品组合、权益定义与版本

**Files:** 新增 `apps/api/src/products/{types,service,controller,snapshot}.ts`；修改 `catalog/catalog.ts`、`applications/applications.ts`、`operations/admin.ts` 及 schema；测试 `apps/api/test/product-version.test.ts`、`product-catalog.test.ts`。

**Interfaces:** `ProductService.publish(tx,ctx,productId,input):Promise<ProductVersionView>`；`ProductService.retire(tx,ctx,versionId,input):Promise<ProductVersionView>`；`snapshotProduct(tx,subscriptionPlanId):Promise<ProductSnapshot>`；`ProductSnapshot` 含标准条款、适用范围、权益版本，参与最终方案 commercialHash。

- [x] 写并运行测试：组合只有一个基础订阅项；版本发布后不能 PATCH；新版本不改旧方案/权益；停用版本不能新申请/确认；旧说明文本不产生次数；车辆不在范围不能报价。
- [x] 写参数回归：发布保留正常订阅 12–120 个月、1500 公里、150 分/公里和月费正整数分限制；报价从发布版本读取并验证，输入不一致返回 409。修改月费需走明确的报价差异；历史 V1_ONE_FEN 受控验收范围与正常产品报价分离，不扩大验收授权。
- [x] 实现 Product/Version、BenefitDefinition/Version、组合项及 SubscriptionPlan 兼容关联；旧逐车套餐逐一形成待核对产品草稿，禁止自动合并相似名称。发布与停用保留操作者和版本记录。
- [x] 运行 `node scripts/run-mvp-api-tests.mjs test/product-version.test.ts test/product-catalog.test.ts` 与 API build；核查公开 DTO 不包含分润、车主证件及内部保单附件。

### N05：保单、保障要求及续保待办

**Files:** 新增 `apps/api/src/insurance/{types,service,coverage,reminders,controller}.ts`；复用 `files/files.ts`；主控新增 schema/迁移/注册；测试 `apps/api/test/insurance-policy.test.ts`、`insurance-coverage.test.ts`。

**Interfaces:** `InsuranceService.review(tx,ctx,policyVersionId,input):Promise<InsurancePolicyView>`；`coverageAt(tx,vehicleId,productVersionId,at):Promise<CoverageResult>`；`CoverageResult` 扩展 GateResult，含适用保单版本及要求版本 ID；`createRenewalReminders(tx,now):Promise<number>`。

- [x] 写并运行测试：保单附件跨车辆借用/自审拒绝；同保险机构重复保单号拒绝；续保新记录、批改新版本；一车多险/一单多车分别检查；缺要求配置、未审核、过期、已生效退保均返回准确 blocker。
- [x] 写时间测试：北京时间 `[startAt,endAt)` 生效/到期边界、续保有一天缺口、长租跨年度无需单张保单覆盖全租期；30/7/0 天提醒同车辆/保单/阈值幂等，服务重启不重复推送。车型与产品保障要求取并集，要求改版需补核验，旧证据不能冒充满足新版本。
- [x] 实现档案与独立复核、保障要求版本、事故工单关联和定时待办；不调用保险公司接口，历史 insuranceDetails 只保留为合同文本。
- [x] 运行 `node scripts/run-mvp-api-tests.mjs test/insurance-policy.test.ts test/insurance-coverage.test.ts`，确认保险到期只产生任务/阻断新交车，不修改已有订单及资金事实。

### N06：分润约定及人工对账结算

**Files:** 新增 `apps/api/src/partners/{revenue-rules,settlements,settlement-payments,settlement-controller}.ts`；修改本域 types、主控 schema/权限；测试 `apps/api/test/partner-revenue-rule.test.ts`、`partner-settlement.test.ts`。

**Interfaces:** `RevenueRuleService.review(tx,ctx,ruleVersionId,input):Promise<RevenueRuleView>`；`SettlementService.submit/review(tx,ctx,settlementId,input):Promise<SettlementView>`；`SettlementPaymentService.record/reconcile(tx,ctx,settlementId,input):Promise<SettlementPaymentView>`；`getSettlementSources(tx,ownerId,period):Promise<SettlementSource[]>` 返回订单实收/退款参考及已使用份额。

- [x] 写并运行测试：规则缺基数/退款约定/协议绑定不能生效；比例与固定金额字段条件校验；押金不能作为分润来源；财务手填金额与明细加总一致；系统不自行计算费率应付。财务可读已归档合作协议用于复核，仍不能读客户/租赁/交还车原始文件。
- [x] 写业务竞争测试：同来源/账期份额不可重复；退款后新建关联原单负数调整；负数应付不可登记负数付款；已提交行不可覆盖；编制人不可复核；新收款账户不能替换已冻结版本。
- [x] 实现规则版本与人工结算明细，客户侧无任何分润字段；后台为财务提供来源/规则/凭据并排核对，已付单仅追加纠错记录。金额上限与余额比较使用可追溯来源份额，费用/调整必须独立分类，不把来源金额和应付金额当作同一个值。
- [x] 实现整单线下付款登记及独立凭证核对；上传付款凭证不立即显示已付，缺凭证/重复提交/非 FINANCE 或 ADMIN 拒绝；不接银行付款、自动分账、提现。
- [x] 运行 `node scripts/run-mvp-api-tests.mjs test/partner-revenue-rule.test.ts test/partner-settlement.test.ts` 与 API build；以合成数据走规则审核、两订单结算、付款核对、后续退款调整。

### N07：把七模块事实接入订单与交还车

**Files:** 新增 `apps/api/src/orders/business-gates.ts`；修改 `applications/applications.ts`、`owner-signing/lessor.ts`、`orders/{readiness,customer-order-view}.ts`、`billing/billing.ts`、`operations/workflows.ts`、`field-handover/service.ts`；测试 `apps/api/test/seven-module-order-gates.test.ts`。

**Interfaces:** `quoteReady(tx,applicationId,planRevision):Promise<GateResult>`；`deliveryBusinessReady(tx,orderId,at):Promise<GateResult>`。前者消费 N02/N03/N04/N06，后者消费当前合作资格、N05 coverageAt 与 v2 合同/资金/交接就绪结果；事务内冻结 `RiskSnapshot/ProductSnapshot/RevenueRuleVersion/lessorSnapshot`，交付留存 coverage 证据。

- [x] 写并运行测试：客户确认与产品停用/规则失效/资料改变/同车抢占竞态只有一个有效结果；旧 effectiveTermsVersion 分支也执行统一合同与新增门禁；证据缺失不能静默退回旧条件。
- [x] 写履约测试：个人出租方三方纸质合同齐全可进付款；少一方/档案失效不放行；付款与资格暂停竞态仍记录可信收款但禁止交车；保单到期/退保阻断新交车而允许登记真实收车。
- [x] 实现统一 blockers 与事务集成，报价候选/审核/发布/确认顺序无循环；不通过前端联调绕过旧 API。以扩展后 O03 生成企业/个人正确的纸质合同与权益附件。
- [x] 运行 `node scripts/run-mvp-api-tests.mjs test/seven-module-order-gates.test.ts test/offline-payment-gates.test.ts test/offline-handover.test.ts test/offline-cancellation-settlement.test.ts`，记录订单、合同、现金、物理收车四类状态未互相冒充。

### N08：订单权益授予及人工服务履约

**Files:** 新增 `apps/api/src/entitlements/{types,service,controller}.ts`；修改 `operations/workflows.ts`、`usage/usage.service.ts`、`orders/customer-order-view.ts` 及 schema；测试 `apps/api/test/entitlement-ledger.test.ts`。

**Interfaces:** `EntitlementService.grant(tx,orderId):Promise<EntitlementView[]>`；`reserve/consume/release/reverse(tx,ctx,entitlementId,input):Promise<EntitlementView>`，每条记录引用订单、工单与幂等键，操作顺序和撤销关联可追溯。

- [x] 写并运行测试：确认方案仅冻结/PENDING，交车幂等激活；说明型无余额；剩一次时并发两个服务仅一个预占成功；取消释放只执行一次；完成扣减预占不重复扣；冲正不超过已用数量。
- [x] 实现现有 Entitlement 增量及次数流水，默认按整单额度，无自动月重置；里程/换车额度仍复用原账本，服务工单必须绑定本客户本订单权益。
- [x] 实现还车后的未使用权益到期及在途工单待处理；不能静默删除已完成使用记录。非法通用 PATCH 余额接口拒绝。
- [x] 运行 `node scripts/run-mvp-api-tests.mjs test/entitlement-ledger.test.ts` 和已有 usage/service 相关测试，核查历史文案权益不被误扣。

### N09：客户小程序与合作商 H5

**Files:** 修改 `apps/miniprogram/src/pages/{vehicle,application,application-detail,record,use,profile}/index.{js,wxml,wxss}`、`services/api.js`；修改 `apps/signing-h5/src/owner/{App,Enterprise,ContractPanel}.tsx`、`client.ts`、`model.ts`；新增 `owner/{PartnerProfile,PartnerSettlements,PartnerPolicies}.tsx`、`partner-workspace.test.ts`、小程序 `tests/seven-module-pages.test.cjs`。O09/O10 其余线下页面要求一并实施。

**Interfaces:** 客户消费安全订单/产品/保障/权益 DTO；H5 消费企业/个人业务身份投影，不把 customer token 传给 owner endpoints；后端数据接口分别由 N02/N05/N06/N07/N08 提供。

- [x] 写页面契约测试：客户四 Tab 不变、无分润字段及电子签动作；个人显示本人资料，企业显示代表/经办关系；合作商的订单/保单/结算只含本主体；查看合同和反馈入口一致。
- [x] 实现客户选产品、看权益与保障、补资料和订单主动作；实现合作商“待办/车辆/订单/我的合作”，复用原 `/owner/` URL，移除 OFFLINE 的选章/手签操作。
- [x] 合并 O09/O10 的文件阅读、异常反馈、退出/会话失效以及空态/错误态；结算显示“待核对/待复核/待付/已登记实付”等准确状态，不显示可提现余额。
- [x] 运行小程序 test/check/compile:templates/build 与原样副本校验、`pnpm --filter @chundian/signing-h5 test` 和 build；使用本地合成网络验证 390/320 宽度，遮罩不挡主按钮、合同/保单权限不泄漏。

### N10：七模块后台、聚合工作台及 FIELD

**Files:** 修改 `apps/admin/src/{App,ui}.tsx`、`resources.ts`、`owner-ui.tsx`、`field/{App.tsx,client.ts,forms.ts}`；新增 `modules/navigation.ts`、`{partners,insurance,products,customer-risk,contract-center,order-workspace}.tsx`（均在 `apps/admin/src/`）、`seven-module-navigation.test.ts`、`scripts/qa-seven-module.mjs`。合并 O11 的人员管理/线下档案组件。

**Interfaces:** `navigationFor(role):ModuleNavigation[]` 返回七模块授权子集与公共工作台/设置；跨模块跳转传资源 ID 与明确视图，不新建重复状态。FIELD 仅消费任务 API，不接受任意订单 ID 读取。

- [x] 写角色与导航测试：ADMIN 七模块、FIELD 无七模块菜单、FINANCE 无风控明细、SUPPORT 无分润；订单详情七分区；合作商协议与订单合同引用同一档案 ID。
- [x] 实现七模块列表/详情/筛选、客户风险任务、企业/个人分支表单、保单续保、产品版本/权益、人工结算复核；只展示服务端允许动作，409 后刷新并解释版本变化。
- [x] 实现工作台汇总责任人及当前阻断项；FIELD 沿用 `https://admin.evsub.ndacar.com/field.html` 与已配置服务号菜单，添加 v2 纸质交接单和实际收车能力，不改为完整后台。
- [x] 运行 `pnpm --filter @chundian/admin test`、build；新增 QA 脚本以本地合成拦截且拒绝外网，覆盖 1440/1280/390/320，读取截图核查表单、复核栏与主动作。

### N11：兼容迁移、全旅程与交付

**Files:** 主控统一 schema/迁移；新增 `apps/api/test/seven-module-journey.test.ts`、`docs/operations/ninda-seven-module.md`、`docs/evidence/ninda-seven-module-acceptance.md`；合并 O13/O14 的脚本、清单与验收证据。

**Interfaces:** 合成全流程调用真实 HTTP/领域服务和本地测试库，支付使用本地受控验证替身且明确标注；不得将合成结果写为真实交易成功。

- [x] 写并运行企业及个人各一条全旅程：准入/合作文件/规则 → 车辆与保单 → 产品/客户风控 → 确认与三方线下档案 → 账单支付 → 查验交车 → 权益服务 → 收车/退款 → 人工合作商结算；跨端归属、文件及角色负例同时验证。
- [x] 实施兼容迁移与回填核对：旧企业类型、旧产品草稿、说明型权益、无伪造保单审核；可售车辆资料齐全才开放新流程，旧 ESIGN 保持原模式。录入缺失项输出管理员待办，不做生产 Mock 回退。
- [x] 依次运行安全测试入口单测、`node scripts/run-mvp-api-tests.mjs --migrate`、`node scripts/run-mvp-api-tests.mjs --all`，再运行三端各自 test/build/QA 和原样副本校验；只在变更/失败/未决问题时重复测试。
- [x] 完成 N01–N11 与 O01–O14 开发映射、操作手册和本地回填事务回滚验证。新路径电子签调用数为 0。O14 后续已完成生产备份恢复验证及服务器发布；真实渠道、真机和微信正式发布仍待验收，不以本地验证替代。

## 5. 文档自审与执行记录

设计要求覆盖：车辆=N02/N07/N10；客户=N03/N07/N09/N10；合作商=N02/N06/N09/N10；保单=N05/N07/N09/N10；产品=N04/N08/N09/N10；订单=N07 与 O06–O08；合同=O03–O05/N09/N10；人员与旧渠道=O01/O02/O12。五项 Review Focus 均有命名负例；没有把前端导航当作后端权限。

完成任务时记录实际文件、验证命令/结果、剩余数据准备项；所有本轮复用/新增步骤默认未完成。提交仅包含经主控确认属于该任务的变更，禁止打包当前脏工作树中其他线程文件。

## 2026-10-27 实施进度更新

业务实现及本地分层验证已完成，合并任务与替代测试文件见 [七模块开发验收记录](../../evidence/ninda-seven-module-acceptance.md)。API 开发全量 859／859、零失败零跳过，N11／O13 开发验收已完成。随后 O14 已完成独立生产盘点、备份恢复验证、空业务库切换及服务器 v4 发布；五份审定线下模板及两份配套说明已发布，小程序 1.1.2 已上传。发布入口 20／20 验证、最终补丁组合回归 26／26、小程序最新 323／323；上述定向检查不合并冒充重跑 API 全量。真实业务材料、微信发布、真机和限定真实交易仍待完成，见 [生产发布记录](../../evidence/ninda-seven-module-release.md)。未提交或推送。
