# Product ROA Pricing Reference Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Complete the approved scope without another design approval round.

**Goal:** 在产品工作台提供可追溯的单车剩余期 ROA、分组统一定价参考和按组生成产品草稿。

**Architecture:** 新增独立 pricing-reference 领域：纯计算引擎、版本化参数与不可变测算快照、后台工作台。沿用现有产品草稿、授权、事务、幂等及发布链路；客户侧不接收内部成本和收益字段。

**Tech Stack:** Existing NestJS / Prisma / PostgreSQL / Zod, React / TypeScript, node:test. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-12-product-roa-pricing-reference-design.md` (user approved).

## Global Constraints

- 仅本项目写入；不连接旧库，不运行真实交易或签章。
- 金额整数分；比例与中间计算保留精度，参考基础费上限向下、目标价格向上取分。
- 基础使用费上限为定价日预估残值的 3.5%；BaaS 为持有成本；不纳入融资或押金收益。
- 定价期为剩余持有期；原采购价按采购车龄归一化；review 后只影响新测算。
- 所有写入验证当前员工权限、revision、幂等请求摘要，事务执行并审计。
- 仅提示参考，不新增定价审批或产品发布财务门禁；分组草稿显式 vehicleIds，modelDefinitionIds 必须为空。
- 无数据时返回具体缺项，不能当作零成本或零残值。
- 基线已提交推送：`faac0e765e73d066f5dbe9dcc2236286b6cf7dd9`，标签 `baseline/pre-roa-pricing-20261113`。本轮功能不自动推送或部署。

## Review Focus

1. 二手购入、review 日期和知晓时间边界，历史快照读取不得重新估算。
2. 零出租率、不完整退出曲线、BaaS 缺覆盖和分组部分可计算，不能输出虚假全量收益。
3. 多车不同资产基数必须合计利润/合计资产，组上限取最小值，组目标与逐车达标目标区分。
4. 重复提交、并发版本、角色变更、部分分组保存失败，不能生成重复或跨组适用产品。
5. 前端修改输入后不能把旧结果当作当前参考，未知响应的写入重试保持相同请求和幂等键。

## File ownership and interfaces

| Owner | Files | Deliverable |
|---|---|---|
| Engine implementer | `apps/api/src/pricing-reference/engine*.ts`, `apps/api/test/pricing-reference-engine*.test.ts` | Pure typed valuation, economics and group engine; export types and stable calculation entry point first |
| Domain implementer | Other `apps/api/src/pricing-reference/*`, `apps/api/test/pricing-reference-service*.test.ts`, `apps/api/prisma/schema.prisma`, new `202611130001_product_pricing_reference` migration | Parameter versions, review correction/withdrawal, input assembly, immutable runs, group draft adoption; publish HTTP DTO brief before UI integration |
| UI implementer | `apps/admin/src/pricing-reference*`, `apps/admin/src/product-editor.tsx` | Scenario/curve/review maintenance, explicit selection, group pricing, per-car results, history/recalculation, recoverable per-group draft creation |
| Root | app registration, role policy, admin App/navigation, API contract, DB/integration tests, plan/report | Integration, local isolated DB validation, review and browser acceptance |

All API paths use `/admin/pricing-reference`: GET/POST scenarios, curves, reviews; POST preview; GET/POST runs; GET runs/:id; POST runs/:id/groups/:groupKey/drafts. DTO details are frozen by domain implementer in `.superpowers/sdd/product-roa-pricing-reference/http-contract.md` and communicated to engine/UI before adapters. Writes include revision and idempotencyKey. Read preview is still CSRF-protected POST. Finance can maintain/reference parameters but group product creation additionally requires products.write.

### Task 1 — Pure engine

- [x] Write failing business tests: purchase-age normalization, review anchor, interpolation bounds, cost occupancy rules, target rounding, missing inputs, weighted group and cap conflict.
- [x] Run `pnpm --filter @chundian/api exec tsx --test test/pricing-reference-engine.test.ts` and record RED.
- [x] Implement typed pure engine and JSON-safe integer outputs; no DB/network.
- [x] Run tests GREEN; self-review against approved formulas and failure cases.

### Task 2 — Versioned domain and persistence

- [x] Publish DTO/engine adapter agreement; write service tests for strict validation, version lineage, snapshot immutability, idempotency and product scope.
- [x] Observe RED, add Prisma models/migration and service/controller with current staff RBAC and serializable commands.
- [x] Resolve actual purchase/battery/contracts/policy metadata; require explicit assumptions where coverage is unavailable; freeze all selected sources and versions.
- [x] Persist runs and per-group adoption uniquely; reuse ProductService.createDraft without publishing.
- [x] Run service tests and build GREEN; report migration/constraints.

### Task 3 — Admin workbench

- [x] Write failing model tests for amount conversion, draft request freezing, dirty inputs, group totals and record replay.
- [x] Implement form controls with labels, source/missing-data detail, explicit selection across pages, group and car tables, parameter/history screens and frozen historical export.
- [x] Add product workbench entry and per-group saved/failed/unprocessed feedback using existing pending-intent approach.
- [x] Run new tests and admin typecheck/build; self-review runtime interaction and mobile overflow.

### Task 4 — Integration and acceptance

- [x] Test role permissions/navigation and register controller and page. Document final API contract and deployment migration.
- [x] Generate Prisma client; use `scripts/run-mvp-api-tests.mjs` guarded loopback `55432/chundian_test` only.
- [x] DB tests: versions/reviews, old run immutability, partial coverage, denied support/finance adoption, concurrent retries, exact group scope, no customer leakage/no auto-publish.
- [x] Run focused existing product/asset and new tests, builds; browser exercise parameter → selection → reference → group draft → historical review.
- [x] Independent full-change review; fix substantive findings and rerun affected checks.
- [x] Record evidence and report outcome and any genuine limitations. No automatic production deployment.
