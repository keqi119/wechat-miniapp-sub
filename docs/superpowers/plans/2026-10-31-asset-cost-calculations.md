# 车辆内部成本计算基础 Implementation Plan

实施记录：本阶段已完成本地验证与限定差异复核，未发布。详见 docs/evidence/ninda-admin-rebuild-20261031.md。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为下一阶段BAAS、折旧和内部成本台账提供已验证的整数分/日期试算基础。

**Architecture:** 纯函数计算，不连接数据库、不产生财务事实。服务端后续基于当前合同、既有计划和权限构造previewHash并确认入库；本阶段函数不自行标记已付、已确认或写客户账单。

**Tech Stack:** TypeScript、node:test、现有错误/整数分约束。

**Spec:** docs/superpowers/specs/2026-10-31-vehicle-assets-design.md；docs/superpowers/specs/2026-10-31-rebuild-reference-rules.md。

## Global Constraints

仅当前项目。币种CNY，单期金额0..2147483647整数分，BAAS周期金额须>0，合计用BigInt后验证安全整数范围。严格YYYY-MM与YYYY-MM-DD，不依赖本机时区；不自动付款、不确认成本、不修改分润/商品/客户账单。继承指定旧代码的整周期及首月完整折旧规则，不新增按日折算。

## Tasks / Scope — admin_scope_audit

- [ ] 先备份并写失败行为测试。只写新 `apps/api/src/asset-costs/calendar.ts`、`vehicle-baas/schedule.ts`、`vehicle-depreciation/schedule.ts` 和相应3个test；不要改schema、控制器、权限或已有商品/订单代码。
- [ ] 日历辅助：严格验证年月/日期，月初/月末、月偏移、日号月末截断、月份差；跨年/闰年/非法日均覆盖，禁止Date自动滚动把非法日期变合法。
- [ ] `previewBaasSchedule({fromPeriod,toPeriod,billingCycle,rentalAmount,paymentDayOfMonth,effectiveFrom,effectiveTo,firstCostPeriod?})`：MONTHLY/QUARTERLY/YEARLY分别1/3/12月；以fromPeriod月初起，toPeriod限制起始月，列出完整周期终日及在起始月的付款日。每期只计一次rentalAmount，不乘周期月数。已有firstCostPeriod须与fromPeriod同相位；不得静默改变锚点。跨出合同起止的行返回明确稳定warningIds，仍展示整期金额，后续确认必须核对这些提示；不裁剪、不折算。最多120期，超限抛错而不是截断。
- [ ] 返回 `{algorithmVersion:'BAAS_FULL_PERIOD_V1',rows:[{costPeriod,periodStart,periodEnd,dueDate,amount,warningIds}],totalAmount,warningIds}`，warningId包含期次及OUTSIDE_CONTRACT_START/END以稳定关联提示。
- [ ] `previewDepreciationSchedule({method,basisAmount,residualAmount,startDate,usefulLifeMonths?,manualPeriods?})`：STRAIGHT_LINE先扣残值，整数除法，尾期补余数；首期从startDate至当月末但为完整一期金额，后续自然月。MANUAL必须显式`[{costPeriod,amount,reason}]`，月份唯一、不得早于起算月，首期以实际startDate起，后续自然月，累计不超可折旧额；不猜月额。NONE返回空rows，不允许夹带手工金额。任何残值>基数、未知method、非整数/溢出均拒绝。
- [ ] 返回 `{algorithmVersion:'DEPRECIATION_STRAIGHT_LINE_V1'|'DEPRECIATION_MANUAL_V1'|'DEPRECIATION_NONE_V1',rows:[{costPeriod,periodStart,periodEnd,amount,reason?}],depreciableAmount,totalAmount}`。直线法月数1–120，零可折旧额仍保持指定期数及零额，NONE区分无计划。
- [ ] 红→绿，测试季300000分只计300000、2027-02付款31落28、闰月29、季跨toPeriod仍完整终日、锚点错位、首末期警示、120上限；折旧10001-1000三期3000/3000/3001、首月中途起算、零值、MANUAL重复/超额、NONE和整数上限。类型检查后给限定diff与日志，无需DB。

## Review Focus

同一日期在不同时区不变；不会错乘季/年金额；首末期不悄悄按天折算；每期整数且直线总额等于基数减残值；手工方式不套自动公式；预览结果不是确认入账证据。
