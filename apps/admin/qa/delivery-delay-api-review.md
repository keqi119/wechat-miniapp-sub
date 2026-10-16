# B1 API独立只读审查

2026-10-16，复查未冻结工作区的`apps/api/src/order-changes`、billing/readiness/signature/usage/handovers衔接、schema015与专项测试源码。未改API、未运行共享数据库或API测试、未调用生产/真实渠道。行号以本轮工作区为准；API同事仍在补回归，全套通过与真实业务验收不由本文替代。

## 发现与修复复核

1. **P1，延期补收单与真实服务期错配。** 原`usage/returns.ts`与`billing/billing.ts`只按SUBSCRIPTION/Bill.sequence识别未来月份；DELAY_ADJUSTMENT.sequence是整单调整编号，导致提前归还后未来补收仍可付、已收未来款漏查，或未付调整单永久挡完成。已及时发主控/API。当前只读确认`order-changes/obligations.ts:4`统一把所有版本sourceBillIds/chargeBillId映射到服务期sequence，冲突409；`usage/returns.ts:25,45`共同用于未来净实收退款检查与未付VOID；`billing/billing.ts:60`使用同一映射拒付未来未履行月份。专项测试源码已加入提前归还拒付/完成VOID回归。修复确认。
2. **P1，原未付押金与延期生效互等。** context允许已签但原押金PENDING的订单发起；finance要求押金实付才能apply，而旧guard只放行新chargeBillId，原DEPOSIT永不匹配。已发主控/API。当前`order-changes/finance.ts:10`在AWAITING_FINANCE/READY明确放行同订单未改价DEPOSIT；其他报价阶段仍拒付，原订阅单不因此解锁；`financeView`仍检查押金实收及退款状态，未直接假定已付。对应回归源码已加入。修复确认。
3. **P2，旧交车单使新日期无法重新确认。** 旧未完成DELIVERY的actualAt不符新条款，新建又受原非SUPERSEDED唯一流程限制，DRAFT不能直接revise。已发API。当前context阻止交接签署PENDING时变更；`finance.ts applyDelay`只在已签/资金核清后将旧未完成交车单SUPERSEDED并审计旧manifest/actualAt，保留确认、签档，不篡改事实。共用handoverOrder先检查deliveryReady，活跃变更阻断create/revise/sign/complete；新日期重新确认/签署。修复方向确认，等待API最终专项证据。
4. **P2，生成的延期退款失败或被拒后无恢复路径。** 原preparedAt阻止再生成、active change挡通用requestRefund，历史FAILED/REJECTED又永久挡apply。已发API。当前prepareFinance在已有资金安排时仅计算原成功实收减所有成功退款减本报价有效分配的欠退余额；仅有确定失败/拒绝记录、无PENDING_APPROVAL/PROCESSING才新建PENDING_APPROVAL，保留旧记录并继续不同财务审批。financeView按本已签方案预期应退与实际成功合计核清，不要求失败历史改成功，safe.canPrepareFinance供同入口恢复。代码修复复核确认；最终回归仍由API同事执行。
5. **P2，safe能力与动作不一致。** canQuote曾给终态REJECTED true但quote拒绝该状态；已反馈且移除，拒绝后须从订单创建新变更。历史safe实际仅id/revision/status/commercialHash四字段，后台兼容摘要展示，不显示伪日期或虚构旧全文。

## 其余检查

- financialContext使用当前effectiveTermsVersion与active服务义务，按同一期原单及历史补收单收集可信SUCCEEDED付款并扣实际成功退款；无跨期搬款，CREATING/PENDING与待审批/处理中退款阻断新方案。二次延期读取上一生效条款，保留原月数、车辆、押金；prepareFinance核对canonical资金快照，先释放旧分配再追加新分配与必要补退，不覆盖PAID Bill/Payment或原finalPlanSnapshot。
- apply由订单锁、change.revision、actor+action+key请求hash幂等及quote唯一termsVersion控制；没有UsageAccount才可生效，不能双建生效版本或把已交车订单再次延期。不同请求并发须一成一冲突；未运行DB，依据源码及API专项证据范围复核。
- deliveryReady在活跃change期间为false；生效后按当前首期有效分配、成功付款扣退款及原押金核验，而非原首期PAID标记。initializeUsage从effectiveTerms读新实际锚点，仍要求actualAt上海日期一致，日期再次变化不自动顺延；已结台账不改写。
- AMENDMENT独立kind、quote/customer/order/hash绑定，PDF读取固定批准文案并校验快照hash；回调走settleContract，但仅SUBSCRIPTION推进主合同付款/交车状态，AMENDMENT只推进自身change到AWAITING_FINANCE。错误kind不能走旧send/prepare路径。两人用印审批、冻结PDF/坐标/计划hash及持久任务恢复复用既有机制。
- safe上下文与详情白名单不返回OpenID、证件、预付参数或私有供应商正文，客户路径按customerId归属；review/prepare-finance限定财务，报价/签前准备/apply限定运营，报价创建人不能自审。新externalCompensationRequired是必填boolean，true明确MANUAL_FINANCE_REQUIRED且不造可签版本，不自动默认为false、不构成权利放弃。

6. **P1，已填补充协议正文权限旁路。** root限定全文仅ADMIN/OPS与客户本人后，通用/admin/contracts列表/详情仍返回AMENDMENT.body，admin/files又可凭source/signed ID读取全文。已发主控/API。当前只读确认operations/admin.ts:25对AMENDMENT低权限去body/source/signed；order-changes详情低权限省正文/归档ID；files.ts:39对amendment用途或关联AMENDMENT的源/签档文件读请求要求ADMIN/OPS，客户仍本人归属。源码修复确认，最终角色HTTP回归由API同事执行。

当前复查范围无额外明确资金阻断。上述修复仍需API同事完成完整回归，尤其二次延期、apply并发、旧交车单和退款失败恢复；后台本轮只做本包测试及隔离浏览器，没有冒称真实签署/支付/生效闭环成功。


最后只读补充：publish预建独立AMENDMENT ID并将现有已实名信息、原主合同已签归档SHA、逐期报价解析成无变量正文；document.templateHash/bodyHash与Contract.body保存，confirm对原文/hash校验，writer再次readVerified原签档及严格比较最终正文。期限expiresAt必填未来ISO，publish/confirm过期409；未确认过期或签署渠道确定REJECTED/EXPIRED可新quote重审，PENDING/未知不重开；客户确认后后续流程不看报价期限。API同事报告19项专项通过，非本人执行。已提醒其自审confirm后尚无task的DRAFT若实名/手机号变量变化而正文不一致时的安全重出路径；默认维持拒绝，不能改已确认正文。
