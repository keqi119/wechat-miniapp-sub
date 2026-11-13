# 经营场景成本卡片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** 上线分类成本维护及期限、复购、坏账驱动的定价参考。

**Architecture:** 保留场景 JSON 追加版本；新增 v2 明细 schema、预算归集适配器和引擎收入损失计算。前端独立经营场景编辑器，复用既有幂等命令和权限。无 DB schema 迁移。

**Tech Stack:** React/TypeScript、NestJS/Zod、Node test、现有 ECS/RDS。

**Spec:** docs/superpowers/specs/2026-11-13-scenario-cost-cards-design.md

## Global Constraints

- 仅本项目写入，开发测试不连接旧库或生产业务库；货币整数分。
- 旧场景与快照不可变；权限、版本冲突与事务幂等不变。
- 产品期限采用本组 months；复购表示老客订单占比；固定营销折算持续到新版本。
- 坏账不作用押金/第三方直付/成本；融资与审批不参与。
- 发布沿用已授权当前宁达环境，不新增付费资源，不恢复撤销的 RAM 权限。

## Review Focus

- 旧场景转换遗漏 null/0 区别或重复旧总额：任务2测试转换。
- 新增可选费用未知金额在不适用阶段误阻断：任务1测试未来投放/处置。
- 不同组期限、分数周期和高复购率误减少实际交付：任务1、2测试。
- 坏账边界100%、零出租率及组反推仍按旧收益斜率：任务1测试。
- 保存未知响应后重试丢明细或更改内容：任务2复用命令，任务3测试冻结。

## Task 1: 服务端预算和评估

Files: apps/api/src/pricing-reference/{types,engine-types,engine,assembly}.ts；新 scenario-costs.ts；相关 test/pricing-reference-*.test.ts。
Interfaces: spec 的 v2 payload/override；引擎结果新增三项收入，input 记录期限和成本分解。

- [x] 写失败测试并运行：576元例、分组3/12月、固定预算持续、按日期摊销、实际覆盖优先、旧版本兼容、坏账反推/边界/组反推。
- [x] 实现严格 schema、成本归集适配器和引擎，保留精确金额及历史路径。
- [x] 运行相关 pricing-reference 单元/服务测试及 API build，报告证据；主控统一提交。

## Task 2: 经营场景编辑器和结果

Files: apps/admin/src/pricing-scenario-{model.ts,editor.tsx}、pricing-reference.tsx/css、相应模型与UI测试。
Interfaces: 严格使用 spec payload；复用 useWrite/WriteNotice。旧场景映射成独立明细，不发送旧总额。

- [x] 写失败测试并运行：转换保留0/null、单位和金额校验、默认期限与组覆盖、营销预算汇总。
- [x] 实现四列背景/三列成本卡片、模板增删、自动汇总及缺项，接入旧版本来源、冻结保存重试。
- [x] 分组默认场景期限；结果展示坏账与成本来源、未来投放费用适用设置。
- [x] 运行相关模型测试、串行UI测试和 admin build；主控统一提交。

## Task 3: 集成、复核与上线

Files: docs/api-contract.md、docs/product-pricing-reference.md、发布记录；.runtime 下独立发布脚本。

- [x] 独立复核接口与计算、浏览器完成场景建版本/3列布局/分组期限/结果流程（隔离测试数据）。
- [x] 更新接口与操作文档，记录验证结果，提交并同步当前仓库。
- [x] 校验生产基线，构建API覆盖镜像及静态发布包，保留回滚点并原子切换；不重跑迁移。
- [x] 生产只读核验健康、资源版本及页面，提供人工验收路径。

## Execution ledger

- 2026-11-13 用户已经批准实施及本线程上线，直接按计划执行，无重复审批。
- Ruling: 在当前干净 codex/product-roa-pricing-reference 分支继续；API/admin 分配文件无重叠，并行可降低等待，主控处理集成与发布。

- 复核结果：51项API计算/服务测试、18项前端相关测试、4项真实DB/权限测试、2项真实浏览器流程通过；两项P2已修复且独立复核通过。

- 2026-11-13 线上版本 20261113-scenario-cost-v2 核验通过，精确镜像已异地归档，最终备份已隔离恢复及OSS完整读回。未新增云服务或数据库迁移。
