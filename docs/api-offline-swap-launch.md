# OFFLINE 换车新建、报价与次数购买

2026-10-31。当前源码接口；生产是否已部署、模板启用和开关状态以发布证据为准。金额均为整数分。普通任意交易条件变更不开放，新电子签仍关闭。

## 新建申请

- `GET /admin/orders/:id/vehicle-change-context` 返回当次订单版本、当前条款摘要和 `canCreate/blockers`。仅当前 ADMIN/OPERATIONS 可创建；其它有读取权限岗位不因看到上下文获得写入能力。
- `POST /admin/orders/:id/vehicle-changes` 输入 `{expectedOrderRevision,priorTermsHash,reason,idempotencyKey}`；客户入口 `POST /customer/orders/:id/vehicle-changes` 只接收 `{reason,idempotencyKey}`，身份和归属取当前会话。
- 真实 OFFLINE 必须有完整有效原合同及已生效补充链、已批准风险凭据、同主体当前人工资格、本人本车当前分配和对应实际交付。不因模式字段为 OFFLINE 就直接通过。存在未完成变更、来源冲突、已确认未来续期等仍拒绝。
- 新建在 Order 锁和 Serializable 事务内重核事实及版本；同键同内容返回原草案，异内容/异类别冲突，当前权限或会话失效不能凭旧键绕过。不同键并发只允许一份活动草案。
- 未交付延期沿原专用 create 接口开放完整来源校验；其它通用变更继续关闭。

## 选择商品、预览和保存

以下前缀为 `/admin/order-changes/:id/offline`，仅当前 ADMIN/OPERATIONS；GET 要求 order-changes 读取权限，POST 保持写权限、Origin 和 CSRF。

| 方法与后缀 | 输入与结果 |
| --- | --- |
| GET `/targets` | `keyword,page,pageSize`，默认1/20，pageSize≤100；返回 `{items,total,page,pageSize}`。支持商品编号、产品名称、车辆名称、VIN及车牌搜索。 |
| POST `/quote-preview` | 下述 PreviewInput；返回金额、逐服务月计算及 `inputHash,sourceHash,previewHash,pricingHash`。不写报价、占车、权益或审计事实，可获取事务行锁。 |
| POST `/quotes` | 原 PreviewInput 加 `previewHash,idempotencyKey`；锁内重新计算并匹配才保存，返回现有变更详情。同事务预占一次能力：赠送按需只建一条，或预占真实已付次数。缺预览摘要400，已变化409 `SWAP_PREVIEW_CHANGED`，其它来源问题按实际领域错误拒绝。 |

目标 item 为 `{targetListingId,targetListingRevision,targetSourceHash,vehicle:{id,title,vin,plateNumber},product:{id,productVersionId,version,name,months,monthlyFeeAmount}}`。摘要来自实际 listedProductSnapshot，不能用商品管理列表的 productSourceHash 替代。列表只提供候选；同出租方、实际占用、运营限制及日期保障仍由预览和提交核验。

PreviewInput 严格字段：

```text
pricingVersion: 2
revision
targetListingId, targetListingRevision, targetSourceHash
plannedReturnAt, plannedDeliveryAt, expiresAt
depositAmount, depositBasis
insuranceResponsibility, downtimeArrangement, settlementExplanation
handoverArrangement, cancellationTerms, reason
externalCompensationRequired: false
```

时间必须为带时区 ISO。禁止传手填 newMonthlyFeeAmount、periods、targetVehicleId 或额外交接费覆盖。仅同价或升级；差额按当前已生效服务段和真实原服务月实际天数计算，逐期四舍五入到分。续期后的全局月号从13等真实序号延续，不能重新从整单原始起租日计算。

预览结果含 target、currentMonthlyFeeAmount、targetMonthlyFeeAmount、serviceStageScope（若有）、periods、押金净实收及应补/应退、handoverFeeAmount=0 和 financialGate=BEFORE_RETURN。periods 保留全局 sequence、段内 stageSequence（若有）、日期、原金额/差额/新金额及净实收/抵扣/应收/应退。

inputHash 对规范输入计算；sourceHash 覆盖真实条款/纸档链/资格/车辆分配/目标商品/实际资金与待冻结方案；previewHash 绑定 change revision、inputHash、sourceHash。不给前端原资格资料或完整内部来源。保存不使用客户端金额。历史自动v2入口和既有成功键回放保持兼容；不增加手填价格通道。

保存/预览均不代替独立财务复核、客户确认、真实纸档签字归档和旧车归还/新车实际交付。改实际日期导致差额变化时必须重报、重确认并核对已收退净额。

## 付费次数

只有 `SWAP_CREDIT_PURCHASE_ENABLED=true` 才开放。真实 OFFLINE 可在 MVP 使用；ESIGN或历史空模式仍保留旧 MVP 限制。未知模式和缺订单关闭。资格、完整纸源及实际交付对每次新购和新支付重核，历史可信到账与退款不因此被丢弃。

- `GET /customer/orders/:id/swap-account`：`canRequest/blockers` 与 `canPurchase/purchaseBlockers` 分别来自服务端；客户端不得仅凭 OFFLINE 自行开关。当前 stage 日期、gift和历史期分别显示；未来未生效续期不算当前权益。
- `POST /customer/orders/:id/swap-credits`：v2输入含 productId=SWAP_CREDIT_TERM_1、pricingHash、termsVersion=SWAP_CREDIT_V2、termsDocumentId、termsDocumentVersion、termsHash、accepted=true、idempotencyKey。不接收金额；使用当前生效服务段冻结的产品单次价及已批准文书。零赠送仍可购买。
- 首次仅创建待支付购买和普通账单；`POST /customer/bills/:id/pay` 保持当前所有账单/归属/纸档守卫，可信成功到账才发一次次数。重复同键、成功通知不多发。
- `GET /customer/swap-credit-purchases/:id` 保留本人已购事实和原有效期。新能力关闭后成功购买键可以只读回放，但当前会话失效仍拒绝；未知收款沿原支付查询。
- 完整未用且未预占的次数仅按原实收全额退款，由独立财务批准与渠道核对；部分退款、预占或已消费拒绝。退款未核实成功前次数冻结。已关闭请求的可信迟到款仍入账、冻结并办理全退，不吞款。

只读预览不预占；正式保存报价时预占，取消或拒绝时释放，实际新车交付后消费一次；升级价差另行结算。原免费次数到期失效，续期按新段确认赠送额度，实际预占时按需生成记录，不在激活时批量造次数；已购次数不因续期自动延长原有效期。四份正式文本批准记录见 `docs/legal/ninda-launch-20261031-approvals.md`，批准不等于已经在生产启用。
