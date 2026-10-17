# 本单一分钱验收报价 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 支持指定申请的12期各1分、押金一次1分真实订单报价，保留真实信用档位和其他订单押金规则。

**Architecture:** 在最终方案新增可空JSON授权快照；服务器通过独立环境配置限定唯一申请、客户、车辆和日期，管理员明确选择后才能使用。客户确认、合同、账单共用冻结的金额和说明，既有订单不因关闭配置而被改价。

**Tech Stack:** NestJS/Prisma/PostgreSQL，React/TypeScript，原生小程序。

**Spec:** `docs/superpowers/specs/2026-10-17-v1-order-lifecycle.md`，用户已授权生成计划后直接施工；本任务仅补首版所需报价差异。

## Global Constraints

- 12个月，每期1分，合计12分；押金一次1分。公开ET5T套餐仍489900分/月。
- 真实信用授权与核验继续必需；不改信用档位，不让低于650或无法核验绕过人工审核。
- `ORDER_ACCEPTANCE_SCOPE_JSON` 含 applicationId/customerId/vehicleId/startDate/firstDueDate/reference；空、无效或不匹配即关闭。生产配置在本单申请创建、资料核对后再写入，本任务不创建真实订单或开启商业供应商开关。
- 只允许ADMIN选择验收价；未选择或普通申请保持现有押金计算。既有签署授权和双人复核不变。
- 车主自行出具出租授权；本次实际交车后提前还车，提前退订费用另行逐单确认。代码不生成这些尚未发生的事实。

## Review Focus

1. 请求伪造/错申请、客户或车辆、缺少配置、非管理员不能使用特价。
2. 免押档和2倍押金档在验收价下均恰为1分，实际档位不变；标准价仍按原规则。
3. 方案发布后配置变化、信用撤回或修改、金额及期限篡改不能确认旧报价。
4. 确认重放不重复订单；12期账单、合同文本、客户页面的金额与1分押金一致；历史标准方案兼容。
5. UI未取得本申请有效配置时不能展示可用的验收选项；审批快照不可从表单提交伪造，服务端重新生成并纳入哈希。

### Task 1: 服务端报价与冻结快照

**Files:** Create `apps/api/src/applications/acceptance-pricing.ts`; modify `applications.ts`, `credit-review.ts`, `contract/contract-template.ts`, `prisma/schema.prisma`; add migration `202610170020_acceptance_pricing/migration.sql`; test `test/acceptance-pricing.test.ts`, extend `test/credit-review.test.ts`.

**Interfaces:** `acceptancePricingOffer(application, env?)` returns scoped offer or null; `finalPlanPricing(application,input,standardDeposit,actor)` produces `{depositAmount,acceptancePricing?}`; `assertFinalPricing(application,final,standardDeposit)` verifies customer confirmation; `acceptancePricingDescription(final)` returns immutable display/PDF wording without requiring currently enabled config. Input `pricingMode?: 'STANDARD'|'V1_ONE_FEN'`; persisted `FinalPlan.acceptancePricing Json?` is server generated.

- [x] Write unit and HTTP regression cases for Review Focus1–4, observe failure before implementation.
- [x] Implement scope validation, amount/term checks, snapshot/hash binding and admin-only selection. Keep existing credit guards before special price resolution. Confirm rechecks enabled scope until order created; repeat confirmation returns the same frozen order.
- [x] Add nullable column with no default/data rewrite, generate Prisma and migrate only local `chundian_test`; run targeted tests and API build.
- [x] Include description in customer final-plan view and per-order contract deposit schedule; do not alter approved template text or historical files.

### Task 2: 后台选择及客户展示

**Files:** Modify `apps/admin/src/credit.ts`, `credit.test.ts`, `form.ts`, `form.test.ts`, `resources.ts`, `App.tsx`; modify `apps/miniprogram/src/pages/application-detail/index.wxml` and relevant existing final-plan tests.

**Interfaces:** Admin credit review supplies `acceptancePricing` only to ADMIN for matching application; `creditPlanInitial` binds that offer; `fieldsForAction` shows `pricingMode` only when available. Monthly fee, dates and term remain explicit fields checked by API; deposit preview shows1分 only in the scoped mode. Native page displays server `finalPlan.pricingDescription` next to actual deposit.

- [x] Add failing tests for scoped field visibility, standard mode default, existing special proposal editing, one-fen deposit preview and no client-supplied authorization snapshot.
- [x] Implement selector and disclosure with ordinary form serialization; no new owner or settlement module.
- [x] Run API test suite, admin tests/build, native tests/template compilation/build. Save evidence, get one fresh-context code review, fix material findings once with regressions, scan secrets and commit/push.

Production quote assembly/deployment follows once the vehicle authorization and per-order commercial materials are ready; this plan makes the capability reviewable without pretending external documents are already available.
