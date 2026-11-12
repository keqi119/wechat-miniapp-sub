# Bill Auto Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 合同生成账单在到期前3天按北京时间自动发布，后台显示时间和阻断原因。

**Architecture:** Nest API分钟扫描与逐单串行事务，复用合同、改单与归还门禁。只读投影供后台展示，显式开关将安全切版与任务启用分离。

**Tech Stack:** TypeScript、NestJS、Prisma/PostgreSQL、React、node:test/Vitest。

**Spec:** `docs/superpowers/specs/2026-10-29-bill-auto-publish-design.md`

## Global Constraints

- 仅本项目和独立平台；测试仅 loopback:55432/chundian_test。
- 金额整数分；不绕过合同/支付/RBAC门禁；真实支付和签署不自动测试。
- 自动范围 SUBSCRIPTION/DEPOSIT；北京时间日历日期减3日；1分钟扫描。
- 不改已有冻结发布证据，不提交其他历史改动。

## Review Focus

- 北京午夜与UTC日期不同，跨月/闰年日期准确。
- 合同迟归档、订单改单/归还时不得提前放行或永远遗漏。
- 并发实例或事务重试不产生重复通知和审计。
- 阻断首批不得使后续符合条件账单饿死。
- 安全发布保全完成前不得启动会写业务数据的任务。

## Task 1: 自动发布业务与调度

Files: `apps/api/src/billing/auto-publication*.ts`、`apps/api/src/main.ts`、`apps/api/src/billing/billing.ts`、`apps/api/test/bill-auto-publish*.test.ts`。

- [x] 先写日期/合同/改单/归还/幂等并发/补发/批处理/关闭调度测试，运行确认失败。
- [x] 实现日期计算、无写业务评估与事务发布；原手工发布拒绝自动类型。
- [x] 实现显式启用、分钟扫描、防重叠及优雅停止，日志不泄露敏感信息。
- [x] 在独立测试库验证并构建API。

## Task 2: 只读投影与后台界面

Files: `apps/api/src/billing/publication-view.ts`、`apps/api/src/offline-documents/readiness.ts`、`apps/api/src/order-changes/finance.ts`、`apps/api/src/operations/admin.ts`、`apps/api/src/offline-documents/workspace.service.ts`、后台资源/资金页/相关测试。

- [x] 写只读门禁与投影测试：读取无revision变化、计划状态与阻断中文可见。
- [x] 提取无写门禁，原写路径保持原锁/写行为；接入列表、详情与内部员工资金页白名单。
- [x] 隐藏自动账单人工发布，手工费用审核保留，测试兼容无投影的旧数据。
- [x] API与admin相关回归及类型检查/构建通过，独立审查。

## Task 3: 发布与核验

Files: `.runtime/ninda/bill-auto-publish-20261029/release/`、`docs/api-contract.md`、`docs/evidence/ninda-bill-auto-publish-20261029.md`。

- [x] 读取线上目标订单/账单日期，仅收集必要状态。
- [x] 冻结允许变更来源，构建新API/admin；新开关关闭下切版并完成备份恢复、旧行旧值保全。
- [x] 单独记录开关启用，核对健康、实际补发的账单及对应唯一审计/通知，排除其他业务变化。
- [x] 更新接口和运维证据，给出目标订单当前预计发布情况。
