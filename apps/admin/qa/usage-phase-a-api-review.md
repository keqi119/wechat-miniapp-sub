# 第二阶段A API独立只读复核

2026-10-16。复查`apps/api/src/usage`、`billing/billing.ts`、`operations/workflows.ts`、`applications/applications.ts`、`contract/contract-template.ts`和相关schema/测试源代码。未改API，未运行共享DB测试，未发真实请求。API同事仍在收尾，因此下列位置以复查时工作区为准。

- P1，里程包退款未收回权益：原普通退款路径可对已发放包退款，随后仍消费同一余额。已发主控及API；主控授权完整未使用包全额例外退款。当前只读确认`usage/refunds.ts:5`检查全额且无CONSUME，审批同账户锁冻结，成功写唯一REFUND流水并归零；`usage.service.ts:50`阻止冻结期间结算，余额仅计ACTIVE。独立复核确认代码修复方向有效；相关HTTP测试由API同事执行，不记作本人实测。
- P2，迟记归还遗留未来期未付款quote：实际归还日在上月末，次日complete前可在下一期购买但未发起付款。归还取消future期，末期settle仅清理<=末期期号quote；`usage/returns.ts:27`将遗留PENDING账单算未付，`:40`先阻止COMPLETE，`:41`全部quote清理不可达。已发API请求回归与修复。当前只读确认usage.service.ts在returnedOn时settle清理全部quote，未知渠道仍阻断；对应迟记归还回归已加入，修复方向有效。
- 已解决筛选问题：到期OPEN在safe中显示AWAITING_READING，原列表按原始status筛选漏掉。当前`usage.controller.ts:18`已按上海日期把到期OPEN纳入AWAITING_READING、从OPEN排除；源代码包含对应回归。

其余只读检查：同账户串行事务、重复支付SUCCESS短路与GRANT唯一sourceKey、按期settlementKey/revision及账单唯一性、前期未结禁止跨月分摊、客户照片归属与月界日期/默认不勾选审核声明、基础1500优先和包FIFO、未知支付阻止结算、还车冻结且历史结清后失效、押金与未来实收退款核清和双人费用复核、客户专属路径与FINANCE/ADMIN能力限制均有相应服务端守卫。当前固定usagePolicy规则和批准文案内容/哈希参与finalPlan商业哈希，进入order快照，合同writer追加同一快照附件；未使用运行时最新文案覆盖已确认历史。未发现额外明确阻断，但这不替代最终API全套或真实渠道验收。


新增补证动作复核：request-evidence以同账户锁、revision与稳定key重开未结月份并保留旧Mileage/审计，OPS与FINANCE动作分别守门。另发现候选P2：14000更正为13900后vehicle.mileageKm/order.confirmedMileageKm仍14000，handoverOrder最低高水位因此会拒绝13900/13950真实还车读数；已及时发主控/API。最终只读确认月审核不再提前抬高vehicle/order确认里程，settle后才推进；workflows.ts:33对当前有效UsagePeriod.endReadingKm聚合守门，create/revise/sign/complete共用，returns.ts另保留防线。较低真实还车create/complete源测试已补，API同事报告专项16/16通过（未由本人执行）。该P2代码修复确认，无剩余明确阻断。
