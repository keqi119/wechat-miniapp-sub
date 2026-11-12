# OFFLINE 订单变更与重复交接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** 主控已审定首包公共来源，开始按包施工。共享 schema、接口和分工由主控冻结；未贯通能力仍保留门禁。

2026-10-31 首包结构冻结：`DocumentArchive.quoteId?` 唯一 FK 绑定真实 `DelayQuote`；`OrderChange.originalArchiveVersionId?` 固定真实初始租赁档案版本，`priorTermsVersionId?` 固定上一个有效条款且通过复合 FK 保证同订单；`DelayQuote.approvedArchiveVersionId?` 在财务准备时固定纸质版本；生效 `OrderTermsVersion.offlineArchiveVersionId?` 保存同一版本。新增 `AWAITING_ARCHIVE`，不把纸质合同改成 SIGNED。所有新增字段对旧记录可空，不补造历史。档案 kind/subject/quote 形状由 SQL CHECK 限制；报价、签字版和初始档案的跨表同单/同客户及完整证据由统一 readiness 验证器检查，不能把单列 FK 当作已完成归属验证。首包不含 FIELD schema，不开放变更执行；后续命令与四入口接入后才能有限解除门禁。

**Goal:** 在真实纸质补充协议、客户确认、资格与财务核对齐备后，办理未交付延期及同出租方等价/升级换车，并支持每次换车的独立还车、交车任务和后续正常结束。

**Architecture:** 复用 `OrderChange → DelayQuote → ServiceObligation/PaymentAllocation → OrderTermsVersion`，另以不可变报价绑定线下档案版本，不能把纸质归档伪装成 `Contract.status=SIGNED`。初始合同与历次生效补充协议组成可验证的条款链；FIELD 按实际交接批次保存任务，原订单、权益、资金和证据历史不重写。

**Tech Stack:** NestJS 11、Prisma 6/PostgreSQL、Zod 4、React 19、现有微信小程序和 FIELD/合作商 H5；不增加依赖。

**Spec:** `docs/superpowers/specs/2026-10-31-admin-rebuild-design.md`；`docs/superpowers/plans/2026-10-31-product-goods-and-swap.md`；`docs/superpowers/plans/2026-10-31-term-swap-credits.md`；`docs/api-contract.md`；原始需求 `D:\工作资料\宁达订阅\系统\宁达订阅系统需求澄清20261030.txt` 第 5.2 项。

## Global Constraints

- 只写本项目；旧仓库和旧业务库只读，本计划不连接旧库、不部署、不执行真实支付或签章。
- 新电子签保持关闭。已有电子签合同、回调、查询与历史文件按原权限保留，不给 OFFLINE 伪造供应商任务、签章、实名结果。
- 金额整数分；实际支付、原路退款、幂等、当前权限、客户归属、版本冲突和事务原子性必须保留。
- 已确认升级规则：冻结的新旧月费差额 × 剩余原合同租期；不足月按原服务月实际天数，新车实际交付日计入新车，每期四舍五入到分；原到期日不延长。
- 合同期赠送次数和额外单次服务费取原订单冻结 `SWAP_TERM_V2`；申请/报价只预占，实际新车交付后消费一次。历史 v1 不自动获得新权益。
- 原用量、TERM 次数及已核销历史不因换车重置；补能仍自付。目标商品是冻结的选车/报价依据，不得静默替换原用量政策。
- 用户已明确首版仅同价换车或升级；降级报价直接拒绝，不当作零退差或等价换车。
- API、PC、客户小程序、合作商 H5、FIELD 均依服务端当前事实和能力显示；未知配置/来源拒绝，不能前端自行放开 OFFLINE。
- 工作树基线按包备份，限定差异复审；DB 仅主控分配的 guard 独占窗口。纯测试先红后绿；不单独提交其他人的文件。

## Review Focus

- 报价过期、被新版本取代或档案被纠正/失效：旧客户确认、旧纸质签字件不得使新报价生效。
- 已收退款后实际交付日变化：不能沿用日期恢复分支而保留已经改变的升级差价，也不能重复收退款。
- 第二次换车、先归还后待交付、并发车辆限制：任务、里程、凭证和资格须绑定各自真实车辆及 assignment。
- 权限/会话撤销、幂等回放和跨客户/出租方附件：每次先查当次授权，历史只读不产生资金、次数或签署副作用。
- 新补充协议生效后的付款、合作商结算、最终归还与终止：验证完整生效链，不把初始 RENTAL 快照改成当前条款。

---

## 1. 当前覆盖与最小增量

| 需求 | 当前真实闭环 | 本阶段最小增量 / 边界 |
| --- | --- | --- |
| 未交付延期 | `order-changes` 有报价版本、独立财务复核、客户确认、逐期应收/分摊/原路退补、显式生效；仅已签且未交付，期数不变 | 接纸质补充协议和新的就绪判定；保留此窄业务，不称为续期 |
| 同出租方换车 | `vehicle-changes` 有目标预留、两侧交接、独立里程段、次数预占/核销；仍依 ESIGN，报价金额人工输入 | 显式选已发布商品，冻结来源，服务端算升级差；纸质补充协议与两份真实交接单贯通 |
| 换车次数付费 | `swap-purchases` 与 TERM 账本已支持冻结产品单价、到账、退款/晚到款/恢复 | 在纸质变更全链闭合后有限放开 OFFLINE 新购/支付；不得只改购买按钮 |
| 提前结束 | `offline-documents/termination.ts`、取消/实车归还/`usage/returns.ts` 有真实纸质协议和资金核对 | 保留既有人工逐单结算依据；补已延期/已换车订单的有效条款链和真实车辆链，不另造自动违约金 |
| 普通交易条件变更 | 只有 `DELIVERY_DELAY`、`VEHICLE_CHANGE` 可执行；不是任意字段编辑器 | 用户已确认首版暂缓，不开放月费/押金/付款日等通用变更；专门流程按已明确规则执行 |
| 续期 | 仅 `contract-pdf-render-model.ts` / renderer 支持 `SUBSCRIPTION_EXTENSION` 展示；没有执行命令/追加账期/延长权益链 | 不把延期当续期。续期期数、定价与权益边界确认后单列实施包 |
| FIELD 重复交接 | 当前任务只能 DELIVERY/RETURN；`@@unique([orderId,type])` 且 service 对全部历史同类型计数 | 改为交接批次唯一，新增两种 swap type；旧完成任务不重启覆盖 |

### 已定位的阻断证据

1. `offline-documents/change-mode.ts` 的 `newOrderChangesEnabled` 同时拒绝 OFFLINE 与 `MVP_V2_ENABLED=true`；当前保护是有意存在的，不能独立删除。
2. `order-changes/context.ts`、`vehicle-changes/service.ts` 只找 `SUBSCRIPTION/SIGNED`。OFFLINE 真实主合同记录已存在于 `Contract`，但归档不把它改成 SIGNED；应关联该真实合同和归档版本，不创建假主合同。
3. `order-changes/quotes.ts` 的 publish 要求已实名 eSignAccount、身份解密和原电子签 PDF；confirm/view 与新签署开关绑定。`order-changes/finance.ts`、`vehicle-changes/handovers.ts` 以及 `orders/customer-handover-view.ts` 的换车业务判断也直接要求 amendment SIGNED。
4. `offline-documents/schemas.ts/context.ts` 只有 OWNER_COOPERATION、RENTAL、DELIVERY_RECEIPT、RETURN_RECEIPT、TERMINATION，subject 只有 OWNER/ORDER/HANDOVER；没有不可变 quote 的纸质档案。
5. `offline-documents/readiness.ts:readContractReady` 始终以 RENTAL 对比当前 terms hash；新条款生效后支付/交付/结算/合作商结算都会受影响。原合同归档不能被更新成新 hash 来绕过。
6. `vehicle-changes/quotes.ts` 只接 `targetVehicleId/newMonthlyFeeAmount/periods[]`，没有 listing 冻结；`upgrade-pricing.ts` 的纯算法尚未接账单。`recovery.ts` 则明确禁止改金额，日期变化仍复用旧 fundsSnapshot。
7. `contract/delay-template.ts` 仍把换车次数写成“十二个月周期免费优先”。TERM 模板须按真实冻结政策渲染；旧历史文本不重写。
8. `vehicle-changes/handovers.ts` 完成时仅覆盖月费、押金、车辆/保障文案，沿用旧 lessorSnapshot；`orders/business-gates.ts` 要求 lessorSnapshot.vehicleId 与当前车一致。新车交付必须检查目标车真实资格、合作范围、保障和限制，不能套用初次交付检查或省掉检查。
9. `field-handover/service.ts` 的 create/edit/publish 依 order 当前车与 assignment，调用普通 createHandoverRecord；不能承接待交付目标车。`offline-documents/field.ts/readiness.ts`、`orders/customer-handover-view.ts` 用 `type==='RETURN'` 选归还单，SWAP_RETURN 会误选交付单。
10. `offline-documents/termination.ts` 对不同有效 amendment 或原合同车与当前车不同会拒绝；归属解析还只认初次 DELIVERY/RETURN。`usage/returns.ts` 超原到期日会报 RETURN_OUTSIDE_TERM，提示人工确认续期，并无续期实现。
11. PC `swap.ts` 和小程序 `services/swap.js` 硬禁 OFFLINE；小程序 `services/order-changes.js` 在签署不可用时也把客户确认/拒绝转成 historyOnly。只改 API 不会形成客户闭环。

## 2. 先冻结的共享契约建议

以下为主控可采用的最小结构，不是已落地 DTO。先审定再 generate/migrate，不能各目录自行另造同义字段。

### 2.1 纸质补充协议与有效条款链

- 继续使用真实 `Contract(kind=AMENDMENT, executionMode=OFFLINE, delayQuoteId)` 承载合同索引；`status` 不假写 SIGNED，provider 字段保持无新任务。
- 新 archive kind 建议 `ORDER_AMENDMENT`，subjectType `ORDER_CHANGE_QUOTE`、subjectId=不可变 quote.id；`DocumentArchive.quoteId?` 实际 FK/唯一，orderId 必须同该 quote 的 change/order。旧种类这些字段为 null；现有按 subject/kind 唯一不能仅用 ORDER，否则多个报价会混同。
- 新版 `OrderChangeStatus.AWAITING_ARCHIVE` 表示客户已经确认该报价、纸质补充协议待归档。审阅/明确归档完成后进入 AWAITING_FINANCE；归档本身不直接生效、不核销次数、不产生“已收款”。
- `DelayQuote.approvedArchiveVersionId?` 和 `OrderTermsVersion.offlineArchiveVersionId?` 建议真实 FK。首次进入财务冻结前 pin 当前真实 ARCHIVED 版本；条款生效保存相同引用。`priorTerms` 另冻结真实初始 RENTAL archive/version/hash 和上一个 termsVersionId/hash，版本链必须同单且无循环。
- ArchiveVersion 的 businessSnapshotHash 必须为该 quote.commercialHash，scope 冻结 quote.id/revision、change.id、priorTermsHash、报价全文 hash、原合同/前次生效版本、双方车辆/assignment 和生效条件。所需签方延用 CUSTOMER/OWNER/PLATFORM；FIELD 交接单仍为 CUSTOMER/PLATFORM。
- 正式文本来自已启用且用途正确的真实法务模板，使用确认过的客户/出租方身份快照；人工资料核对不伪装实名。保留实际生成、打印确认、签字件上传、核验和显式归档。新报价不能继承旧签字件。
- 归档纠正保留旧材料。任何已 pin 的版本失效/异议均使后续新执行阻断；修复通过新的档案/报价与明确重新核对，不改既有生效历史。

建议公共只读接口（名称在 Task 1 锁定）：

```ts
type ChangeAgreement =
  | { mode: 'ESIGN'; contractId: string; documentHash: string }
  | { mode: 'OFFLINE'; contractId: string; archiveId: string;
      archiveVersionId: string; quoteId: string; quoteRevision: number;
      commercialHash: string; fileManifestHash: string };
readChangeAgreementReady(tx, changeId: string): Promise<{
  ready: boolean; blockers: Array<{code: string; label: string}>;
  agreement: ChangeAgreement | null;
}>;
requireChangeAgreementReady(tx, changeId: string): Promise<ChangeAgreement>;
readEffectiveContractChain(tx, orderId: string): Promise<{
  original: {contractId: string; archiveVersionId: string; businessHash: string};
  termsVersionId: string | null; termsHash: string; amendmentVersionIds: string[];
}>;
```

读接口不写 revision、不补发权益、不触发供应商。命令先取得订单锁并查当前权限再调用同一验证器；ESIGN 历史分支仍验证原签署事实。`readEffectiveContractChain` 的上述返回形状专用于 OFFLINE；不能拿缺少 paper version 的 ESIGN 历史假充纸质链。

### 2.2 升级报价的不可变输入与金额

- 在 `vehicle-changes` 新增显式版本化报价形状（例如 `pricingVersion:2`）：revision/key、targetListingId、targetListingRevision、targetSourceHash、plannedReturnAt、plannedDeliveryAt 及原有必需事实说明。目标车辆、目标 product/plan、月费均服务端从同一已发布可见 listing 冻结；不接受客户端覆盖新月费或逐期应收。
- 使用现有 `calculateUpgradePricing({startDate,months,currentMonthlyFeeAmount,targetMonthlyFeeAmount,deliveryAt})`。保存完整结果和 hash：原合同边界、当前 terms id/hash、目标 listing/product 快照、规则版本、上海交付日期、各期天数/差额/合计；存库单期须满足 PostgreSQL Int，合计须为安全整数。
- 原本每期应收来自当前有效 ServiceObligation/terms；新逐期应收在该基线上增加本次差额，不重算已经履行的前次价格。第二次换车仍取当前有效月费，原起止日不变。
- 原客户确认、纸质协议与财务确认必须绑定同一 quote/hash。实际交付日不同时先拒绝完成，要求新版本重新计算/确认/归档；已收退款要按真实历史生成明确净差调整，不能把旧 fundsSnapshot 直接接到新日期上。
- 复用当前“当期及之前资金核清后换车、未来期按原到期日主动付款”机制。升级总差额不因此自动变成一笔立即全额到期款；若业务希望一次付清，应明确另改付款约定。
- 产品的超赠送次数单价只产生 SWAP_CREDIT 购买。旧可手填 SWAP_HANDOVER_FEE 不应成为新版随意附加收费入口；本草稿不新增这类收费政策，历史账单仍可读/核对。
- 目标商品下架/产品暂停发生在报价冻结后：新报价拒绝；已确认报价只能按其冻结来源继续核对真实车辆预留/资格/合作/保单，不用当前目录价重写原承诺。该区分需测试，不能把历史 hash 换成新 hash。

### 2.3 FIELD 的最小重复批次结构

- 新 task 类型 `SWAP_RETURN/SWAP_DELIVERY`，`changeId?` 与 `batchKey`；移除全订单同 type 唯一，改 `@@unique([orderId,batchKey])`。新 swap 批次由服务端决定 `CHANGE:<changeId>:RETURN|DELIVERY`，不能由客户端任意命名绕过唯一。
- 初次交付使用 `DELIVERY:<真实 termsVersionId 或 INITIAL>`：同一有效条款只一批，未交付延期生效后可以按新 termsVersionId 创建新批，旧事实仅 supersede、不覆盖。最终归还使用 `FINAL_RETURN:<真实 assignmentId>`。旧任务迁移只保留一个稳定 `LEGACY:<task.id>`，不推测换车/已交付事实；服务端仍拒同一个实际交接已经存在时再建另一任务。
- vehicleId/assignmentId/changeId 由真实变更及当前分侧推导；换入车未交付时 assignmentId 可以 null，完成后写真实结果。投影展示 task 绑定车辆的车牌、仪表基线，不用 order 当前车覆盖。
- 同批修订沿用 task.version 和 materialGeneration；已完成批次不 restart。不同批次新增记录，附件不能跨批/跨员工/跨客户借用。
- 所有 RETURN 类型都保留实际安全接车通道；只有 ALLOCATION/DELIVERY 检查对应运营限制。新的计价/纸质合同问题不得伪造实际未还车，也不得把实车已接收直接当财务结清。

## 3. 可并行文件边界与任务

主控先持有 schema、迁移、auth/files/App 注册、`offline-documents` 以及跨域 guard。报价与 FIELD 可在契约冻结后并行，但同一个 `vehicle-changes/handovers.ts` 只给一人；FIELD 通过其导出命令调用，不并写。

### Task 1：共同来源与线下补充协议（主控/单一 owner）

**Files:** 修改 `apps/api/prisma/schema.prisma`、下一个未占用新迁移（先核当前最大号）、`offline-documents/{schemas,context,archive.service,archive-workflow,readiness,projection,workspace-facts,partner-access,change-mode}.ts`；新 `order-changes/agreement-readiness.ts`；新纯测试及 `offline-change-archive-db.test.ts`。受影响 `orders/customer-contract-view.ts`、`owner-h5` 只读投影、auth/file 路由由同 owner 整合。

**Interfaces:** 产出 2.1 的共同验证器；现有 archive 路由添加 quote subject，不另建万能上传入口。

- [ ] 先以当前 OFFLINE 主合同真实 DRAFT+ARCHIVED fixture 写红测：缺归档、错单/quote/hash、旧报价签字件、REVIEWED 未归档、异议/失效均拒绝，不能调用任何 eSign/身份供应商。
- [ ] 增加 SQL fresh helper：新增 FK/唯一/互斥字段的合法与 NULL/错归属边界；旧数据不补造签字或生效版本。
- [ ] 实现 archive 来源和新等待状态，冻结 paper version；在付款/结算/合作商结算入口统一验证原合同加生效链。
- [ ] 验证当前权限先于回放；同 key 只一次，旧 successful key 保留历史结果但不会重新落账/归档；版本冲突需显式重核。
- [ ] 纯测试红绿、tsc；获独占后 `node scripts/run-mvp-api-tests.mjs test/offline-change-archive-db.test.ts`。限定 manifest/diff 复审，主控统一 generate。

### Task 2：先贯通未交付延期

**Files:** `order-changes/{context,service,quotes,finance,controller}.ts`、`contract/delay-template.ts`；新 `offline-delivery-delay.test.ts` / `offline-delivery-delay-db.test.ts`。不改旧 signing/provider 回调。

**Interfaces:** 复用 Task 1 readiness；现有 create/quotes/review/publish/confirm/prepare-finance/apply 路由保持兼容，OFFLINE confirm 转 AWAITING_ARCHIVE。

- [ ] 红测真实主合同归档+未交付允许草案；已交付拒绝；相同月数、延后起租；财务复核人与报价制作人不同。
- [ ] 拆开“客户接受商业报价”与“发起电子签”的能力，仍要求本人、当前协议同意和 exact commercialHash；人工资料不能降低资格/风控检查。
- [ ] publish 冻结线下全文，归档后才能 prepare-finance；资金沿用/原路退补复用原逻辑，apply 另建 terms 版本且过期交接仅 supersede，保留实际事实。
- [ ] 红测一次生效后第二次延期、支付已变化、回放、客户越权、档案失效阻断、签署供应商调用为零；纯绿后 guard 单文件，再回归原 `delivery-delay.test.ts` 与相关 offline gates。

### Task 3：等价/升级换车报价与资金（独立 owner）

**Files:** `vehicle-changes/{quotes,recovery,finance,service,account,view}.ts`；新 `vehicle-changes/offline-pricing.ts`；`order-changes/quotes.ts` 的共享 publish 修改与 Task 2 owner 串行交接；`swap-purchases/{controller,ledger,view}.ts`、模板更新由同一包明确接管。不复制或改弱已通过的 upgrade pure 算法。

**Interfaces:** 产出 2.2 的 v2 quote 投影/输入；消费 Task 1 readiness 和真实 listing snapshot helper；输出冻结 pricing、target source、可交接财务 gate。

- [ ] 红测客户端篡改月费/periods 被拒；同价格差为零；低价保持 DOWNGRADE_NOT_SUPPORTED；31 日/月末/闰月、同日多次升级、最后一天、Int 超界。
- [ ] 红测报价冻结后商品状态变化不改旧金额；新报价只能取可售当前源；原 TERM/usage 不重置，目标范围/出租方不符合拒绝。
- [ ] 冻结服务端价格与合作/资格来源，复用义务/分摊历史；模板按 v1/v2 明确显示次数规则，不能沿用“年度免费”文字。
- [ ] 红测已支付后跨日交付报价变化：旧 quote 不可完成；新版本需客户和纸质确认，净差账单只一次，原付款/退款与已完成旧车归还不可覆盖。
- [ ] 开放本包已支持的 OFFLINE TERM 购买/支付门禁；原冻结产品单价、付款精确金额、重复到账、晚到款核账、退款/恢复守卫全部复用。不给旧 v1 OFFLINE 增送权益。
- [ ] 纯测试与 tsc；guard 新专项后按实际受影响范围回归 `vehicle-change.test.ts`、`term-swap-db.test.ts`、`swap-purchases.test.ts`，不执行真实支付。

### Task 4：双侧实际交接与 FIELD 重复任务

**Files:** 单一交接 owner 修改 `vehicle-changes/handovers.ts`、`operations/handover-records.ts`、`orders/{customer-handover-view,order-process-handover,business-gates}.ts`、`offline-documents/{handover,field,readiness,vehicle-receipt}.ts`；FIELD owner 修改 `field-handover/{service,controller,rules}.ts`、`apps/admin/src/field/{App,OfflineReceipt,forms}.ts*` 及新测试。共享文件由主控择时合并。

**Interfaces:** 交接 owner 导出按 changeId/side/taskId 接收真实事实的单一创建/完成入口；FIELD 不复制换车 guard。双方锁定输入中 order/change/vehicle/assignment 的服务端推导和 expected revision。

- [ ] 红测未交付延期后新 terms 批次、一单初次交付→第一轮 SWAP_RETURN/DELIVERY→第二轮同类任务→最终 RETURN；每批文件/里程/当前车辆正确，重复同批只返回原结果。
- [ ] 实现 2.3 schema 对应业务，不清除历史完成任务；重新指派后旧 FIELD session 立即失权，旧附件代际不能再上传/下载。
- [ ] OFFLINE 两侧都要求本人事实确认及同 manifest 的 ARCHIVED 交接单；`isReturn` 明确涵盖 RETURN/SWAP_RETURN，绝不写假 SIGNED。
- [ ] 新车交付重读真实资格、被冻结主体、目标出租资格/合作/分润凭据、实际保障、预留与 DELIVERY 限制；与同车新限制并发只能一个安全执行。归还不被交付限制阻挡。
- [ ] 红测实际日偏离报价、旧车已归还但目标不可交付、串用另一变更/车辆/档案、途中取消/恢复；实际成功才一次消耗 credit 和创建新 assignment/terms。
- [ ] 纯/实际 FIELD 组件测试、1440/390 截图及构建；guard `offline-swap-handover-db.test.ts` 后保留旧 `field-handover.test.ts` 和 asset 文件边界回归。

### Task 5：换车后终止/最终归还兼容

**Files:** `offline-documents/{termination,cancellation,readiness}.ts`、`usage/returns.ts`、必要的 customer/owner workspace 投影；新 `offline-changed-order-termination.test.ts` 和 DB 专项。

**Interfaces:** 消费 Task 1 effective contract chain 及真实 assignment/handover；不建立新的自动退款政策。

- [ ] 红测初次车由 SWAP_RETURN 结束、换入车从 SWAP_DELIVERY 开始后正常 RETURN，准确匹配同单/同客户/同车/区间 `[startAt,endAt)`；跨单和缺双侧完整证据仍拒绝。
- [ ] 终止模板列原合同、历次有效补充协议和当前实际车辆；保留原冻结提前终止/押金规则，显式金额/依据、实际收退款、三方纸质归档与实车接收证据。
- [ ] 日期/当期里程/预付未来款/未消费权益仍按既有结算链核对；未设置自动违约金不自行产生收费。补充协议、付款异议或未知资金结果不报结清。
- [ ] 纯绿及 guard 新专项，回归 `offline-termination-snapshot.test.ts`、`offline-cancellation-settlement.test.ts` 与相关 return 测试；使用真实 SWAP 类型，不以 DELIVERY fixture 冒充换车。

### Task 6：四入口投影、恢复与联调

**Files:** PC `apps/admin/src/{delay,delay-ui,swap,swap-ui,swap-form,swap-facts,swap-credits-ui}.ts*`；客户 `apps/miniprogram/src/services/{order-changes,swap,paid-swap}.js` 及这些 services 的实际页面引用；合作商 `offline-documents/{workspace-facts,partner-access,projection}.ts` 与现有 owner H5 页面；FIELD 使用 Task 4 页面。主控统一注册/导航，不并写。

- [ ] PC 显式选择发布商品版本和报价，显示各期差额/依据与档案进度；手工金额字段对 v2 不再写入。支持旧 ESIGN 只读，不隐藏真实历史账单。
- [ ] 客户允许独立确认/拒绝 OFFLINE 报价，显示纸质进度；不能调用 prepare/sign/provider。既有客户事实确认、当前隐私授权保留。
- [ ] 合作商 H5 按真实当前代表人、该出租方与客户共享范围读取对应补充协议及两侧事实；无新合同签章按钮、无全客户/全部工单附件访问。
- [ ] 实际组件红绿：未知响应同 body/key 重试；已确认写成功、GET 失败只 GET 恢复；409 保留输入但必须核新版本；401/403/404/会话/记录变化立即清除私有事实。
- [ ] 四入口同一合成订单：初始纸质合同→延期→实际交车→TERM 赠送换车→再换车付费→最终归还/终止；核对资金、assignment、原到期日、每份证据、credit 各只一次。无真实支付/签章，无数据库测试并行。
- [ ] 小程序专项、PC/FIELD 实际组件与 1440/390 视觉、tsc/build；完成精确范围独立复审和文档契约同步后，最后才更新已覆盖能力的门禁。

## 4. 真正待明确的业务分歧

本轮不向用户发问；由主控按实施顺序统一确认。已有规则可继承的事项不重复询问。

1. **同价/升级范围已确认**：首版不允许降级；自动报价返回明确业务阻断，不生成降级退款。
2. **续期核心规则已确认**：原订单追加租期并签补充协议；重新选择该车已发布商品，按其产品租期/月费/里程规则报价；新阶段重新赠送换车次数，旧赠送到期失效不结转，已付费次数按原有效期保留。原服务期仍按原规则结算。须另立阶段模型、账期及权益迁移计划；继续用车仍需完整合作/保障覆盖、客户确认和纸质归档，不因原合同已签自动续。
3. **一般交易条件变更已确认暂缓**：首版只保留延期、提前结束、续期和换车专门流程，不做任意 JSON 或状态编辑器，也不开放单独改价/改押金。
4. **额外交接收费（仅若要求保留）**：旧换车报价允许人工 SWAP_HANDOVER_FEE，用户新确认的是产品配置的超赠送次数单价。两者不能默认叠加；首包不新增这类收费，如确需另收再给收费依据和冻结方式。

无需新增提问：升级实际日折算、逐期四舍五入、合同期赠送数、超次单价、充换电自付均已明确；同出租方限制、原期限不延长、已用权益不重置、真实资金核对、纸质签署及当前资格可以直接沿既有规则。提前结束先保留已有人工逐单金额/依据与真实退款，不把“做变更中心”解释为授权新违约金公式。

## 5. 范围外及收口标准

- 不开放跨出租方换车、自动续期、降级退款、自动扣款、自动外发通知、自动签章、任意改原合同/账单。
- `asset-work-orders` 客户 ServiceRequest 专用选择/详情核对/来源版本绑定入口已在独立15文件包完成本地验证（证据 `tmp/admin-work-order-source-ui-baseline`）；最终创建仍核真实 assignment、当前权限与来源摘要。不把这一独立工单能力算作订单变更完成。
- 初稿时只有源码审计；当前已完成 013 纸档关联和 014 交接批次本地隔离迁移、完整协议链校验、延期两次真实 HTTP 纸档/财务/生效验证及旧延期回归。当前换车只完成自动报价草案验证，尚未完成四入口闭环；总开放门禁保持，未部署。
- 最小可交付顺序为 Task 1+2，随后 Task 3+4，最后 Task 5+6 验证后有限开放。每个中间包保持未贯通能力关闭；续期与一般交易条件变更在业务范围冻结后另立执行计划。
