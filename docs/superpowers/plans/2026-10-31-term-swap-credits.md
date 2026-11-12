# 合同期换车次数与冻结购买价格 Implementation Plan

实施记录：本阶段API、迁移、客户端与独立复核已完成本地验证；OFFLINE实际变更仍未开放。详见 docs/evidence/ninda-admin-rebuild-20261031.md。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 已确认的合同期赠送次数与产品配置单次服务费进入可核对、幂等的专用账本，保留全部历史年度次数及800元购买记录。

**Architecture:** 复用SwapCredit、SwapReservation、SwapLedger和SwapCreditPurchase。原订单产品快照是唯一政策来源；合同期赠送按实际预占逐条创建，付费次数须可信到账后产生。此阶段不解除OFFLINE订单变更/购买总门禁，待线下变更协议及实际双侧交接闭环完成后才开放。

**Tech Stack:** NestJS/Prisma/PostgreSQL、React、原生小程序。

**Spec:** docs/superpowers/specs/2026-10-31-admin-rebuild-design.md；docs/superpowers/plans/2026-10-31-product-goods-and-swap.md。

## Global Constraints

只写当前项目；金额整数分。不得用当前目录价格验证历史付款。DB仅guard独占本地隔离库；真实交易/签署不在测试范围。旧周期序号不可冒充新赠送序号。用户已确认首版只同价换车或升级，不支持降级。当前或目标里程政策不变。本阶段不生成升级差价账单，不开放旧OFFLINE门禁。

后续续期已获业务确认：原订单追加服务期，按该车新选已发布商品报价；续期阶段重新发放该产品赠送次数，原赠送到期不结转，已付费次数按原有效期保留。现有单合同 TERM 不能通过重置余额实现，续期另立阶段模型与迁移包。

## 数据与契约

主控新增SwapCredit.termSequence Int?、policySnapshot Json?及(orderId,termSequence)唯一；SwapCreditPurchase.pricingSnapshot Json?。均无默认、不回填。兼容修改旧SQL的SwapCredit_source约束及SwapCreditPurchase.amount=80000约束：v1空快照仍只允许原字段/金额，v2明确正整数分和结构，业务层验证完整来源。

`swap-purchases/policy.ts`统一解析原订单`finalPlanSnapshot.productSnapshot`：v2须配置完整合法swapPolicy及产品身份，形成`{policyVersion:'SWAP_TERM_V2',includedCount,extraFeeAmount,sourceHash}`。sourceHash为规范化的产品ID、版本ID、版本号和原swapPolicy摘要；不读活跃商品。未知或不完整v2拒绝，不能回退v1。旧v1周期语义保持；历史OFFLINE不凭空新增赠送。

购买冻结`{policyVersion:'SWAP_TERM_V2',sourceHash,quantity:1,amount,currency:'CNY'}`，amount等于原订单extraFeeAmount；`pricingHash`为规范化购买快照摘要。v1记录继续null并严格80000分。新商品标识`SWAP_CREDIT_TERM_1`，条款version=`SWAP_CREDIT_V2`，法务类型`swap-credit-v2`，模板必含`{{extraFeeYuan}}`，可选`{{extraFeeAmount}}`；未知/残缺变量拒绝，冻结模板/渲染正文各自hash。v2无已批准模板不可新买。输入只带产品标识、pricingHash和同意文档信息，不允许客户端覆盖金额。

v1只读cycle字段保持；v2返回policyVersion和`term:{startDate,endDate,includedCount,remaining,reserved,consumed,available}`。remaining表示未消费总数，含当前预占；available为满足在有效用车期条件的未预占余额。返回购买商品真实amount/quantity/currency/pricingHash；预约/流水从关联credit投影scope:'TERM'和termSequence，无需修改旧流水表。真实新车交付时扣次数，不能以创建变更单代替消费。

## Tasks / Scope

### A API — three_end_audit

- [ ] 先备份本阶段文件。仅可写vehicle-changes/credits.ts、account.ts、swap-purchases目录以及对应测试；确需其他调用点先报root分配。
- [ ] 先红测：v1快照/年度周期保持、v2零赠送/极大数读取零建行、预占仅一条、最后一次并发竞争、取消释放复用、跨年不刷新、实际交付幂等、错误政策/哈希拒绝。
- [ ] 按需创建TERM赠送记录，优先复用释放记录，无空位才max(termSequence)+1；在订单/账户锁下重读，保留预占部分唯一索引和consume唯一sourceKey。不可对includedCount循环建海量记录。读请求不产生赠送写入。
- [ ] 统一冻结购买金额核对并更新到账、重复到账、退款、晚到款核账、恢复及视图；保持订单/客户/账单/支付/权益链条校验。非80000金额全流程、全额退款、已消费/预占/部分退款拒绝和原v1回归先测后实现。
- [ ] 确认purchaseEnabled与newOrderChangesEnabled门禁都仍生效，OFFLINE新办理/购买/支付保持关闭；可信回调和历史查询不因新政策消失。
- [ ] 纯测试/tsc后，根迁移完成并授予独占时段，再运行guard DB；交付限定diff、日志和接口实际字段。

### B 主控

- [ ] schema/迁移/生成客户端；迁移检查旧check名与索引保留，加入独立新schema完整迁移试跑。
- [ ] 购买文档类型的后台下拉及API枚举由当前独占operations/admin.ts/resources.ts的modelYear代理合并，禁止两人并写。
- [ ] 客户小程序和后台展示合同期次数、冻结价格、稳定幂等与未知状态拒绝，原样视觉保持；接口实现稳定后再分派。
- [ ] 新购买模板只存待审草稿，不在线发布。独立审阅后更新契约/证据，再继续完整OFFLINE变更，不把账本完成说成已开放换车。

## Review Focus

大额度不触发批量写；最后一次并发只有一个预约；冻结金额与原付款一致；退款回调不毁掉另一笔有效权益；不把不明旧记录静默归类为新TERM；v1/v2不会因配置缺失互相回退。
