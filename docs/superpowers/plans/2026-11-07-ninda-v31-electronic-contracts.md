# 宁达 V3.1 自动填制及电子签 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 V3.1 六份合同与独立用印授权接入现有四端，实现真实资料自动填制、可信电子签归档以及与实际履约一致的费用/退款流程。

**Architecture:** 复用现有统一 electronic-documents、法大大 API 2.0、订单阶段/支付/交接模块。先统一服务日历和版本化数据，再接通电子文书，最后替换当前纸质业务入口。2026-11-07 用户已批准开始实施；合作5/5/15、补足2、返还3、开票10工作日默认值已确认，例外另约。实施进度及核验以任务记录为准，尚未完成上线。

**Tech Stack:** 现有 NestJS、TypeScript、Prisma/PostgreSQL、PDFKit、React、微信小程序；沿用仓库依赖，不新建签约系统。

**Spec:** `docs/superpowers/specs/2026-11-07-ninda-v31-contract-autofill-design.md`；详细来源及字段映射见 `docs/legal/reviews/ninda/20261107-v31-contract-field-audit/`。

## Global Constraints

- 仅本项目写入；旧仓库、旧数据库只读来源，禁止连接旧业务库做开发测试。
- 金额整数分；客户归属、后台 RBAC、版本冲突、事务幂等、支付/签署回调校验不可省略。
- 法大大结构复用来源提交 `453da778dcfefd3727813179382490903644ef26`，不读取落后的旧工作树替代它。
- 密钥禁止输出/入 Git/入前端。真实交易和签章测试需主控确认明确范围。
- 产品条件 `actualMonths >= minimumTermMonths >= 3`；原日号跨短月及续期继承，区间含起不含止，Asia/Shanghai。
- 同商同价/升级换车，原押金不变；03—06 及合作文书默认企业逐份确认；独立授权只允许 V3.1 主订阅自动用印。
- 退款/资金调整双人复核；实际交接不新建电子签协议；不恢复保障要求管理、跨合作商换车或普通任意交易条件调整。
- 晓浪不成为合同方、被授权人、业务通知接收方或档案办理方；真实渠道身份不符合时不能用本地显示掩盖。
- 当前工作区已有大量并行历史改动；实施时建立任务基线，禁止批量暂存、提交或覆盖他人文件。

## Review Focus

- 1 月 31 日经过 2 月及 4 月末续期仍回到 31 日：任务 1 的固定案例。
- 首期支付成功后实际交付改期，不重复收款、不回写已签文件：任务 5 的交付事务案例。
- 外部请求已接受但本地超时/撤回，旧链接继续签或晚回调：任务 4 的不确定结果案例。
- 合作主协议签过但附件三未独立签、产品范围越界或授权撤销：任务 6 的范围与并发案例。
- 已有真实期前取消/收车但核验或退款跨日期、归档失败：任务 8—9 的时点与财务案例。

## 文件与接口边界

以下新增路径和类型是实施建议；`Modify` 路径为本次已核实的现有模块，详细行号随工作区变化以审阅证据清单为基线。数据库变更写入项目现有迁移机制，具体迁移文件由实施时序号决定，不更改既有迁移。

| 单元 | 责任 |
|---|---|
| `apps/api/src/contract-terms/`（新） | V3.1 条款类型、字段映射、资料完整性、快照与例外，避免塞满 prepare.ts |
| `apps/api/src/service-calendar/`（新） | 同一原日号的服务期、日期边界及日内末期算法 |
| `apps/api/src/electronic-documents/` | 模板、生成、三方编排、独立授权、可信签署/归档证据、安全停止 |
| `apps/api/src/settlement-obligations/`（新） | 债务/扣抵关联、退款义务时钟、保留金案件及财务投影，复用现有支付退款执行 |
| 现有 products/applications/order-service-stages/order-renewals/vehicle-changes/orders/usage | 各业务数据来源与事务推进，不能另起第二套订单状态机 |
| `apps/admin` / `apps/signing-h5` / `apps/miniprogram` | 当前真实路由接入同一 API，替换纸质办理入口及状态表述 |

统一标识：文书业务类型与 CUSTOMER/OWNER/PLATFORM 角色和甲乙丙排版分离。拟增 `COOPERATION_SEAL_AUTHORIZATION`，不通过 startsWith('COOPERATION') 自动把它当合作生效事件。

共享类型（由任务 1、2、3 按责任导出）：

```ts
type MoneyCents = number; // 安全整数；边界层逐项验证
type ServiceAnchor = { firstStartDay: string; anchorDay: number; ruleVersion: 'V31' };
type ServicePeriod = { index: number; startDay: string; endDayExclusive: string };
type V31Context = { kind: string; resourceId: string; revision: number; businessHash: string };
type MissingField = { key: string; sourceResource: string; maintenanceRoute: string; reason: string };
type ContractArtifact = { fileId: string; sha256: string; templateHash: string; snapshotHash: string; positions: unknown; pageCount: number };
type VerifiedSignFact = { role: string; providerSignedAt: string; verifiedAt: string; queryEvidenceHash: string };
```

## Task 1: 独立期限与统一服务日历

实施记录：2026-11-07 已完成代码与数据库约束，独立审阅 Spec PASS / Quality PASS（1项可选字段校验Minor承接任务2）。相关测试76/76及原账期测试2/2通过，API构建通过；任务5接实际交付初始化，任务10接新产品最短期限的页面建议值与确认。完整套件和真实渠道验收仍待任务11。

**Files:** Create `apps/api/src/service-calendar/rules.ts`, `types.ts`; Modify `apps/api/src/products/types.ts`, `products/snapshot.ts`, `applications/applications.ts`, `billing/rules.ts`, `usage/rules.ts`, `order-service-stages/source.ts`, `order-renewals/context.ts`, `electronic-documents/prepare.ts`, `apps/api/prisma/schema.prisma`; Test `apps/api/test/v31-service-calendar.test.ts`（新）。

**Interfaces:** `servicePeriods(anchor: ServiceAnchor, startPeriod: number, months: number): ServicePeriod[]`; `remainingRentCents(periods, rates, stopAt): MoneyCents`。产品快照增加 minimumTermMonths，实际 months 保持现有选择产品的来源；订单及阶段保留原始 anchor 引用。

- [x] 写失败测试：3 月可发布，2 月拒绝；minimum=3、actual=12分别保存；actual小于minimum拒绝；2027-01-31起3期分别截止02-28/03-31/04-30，续期首期截止05-31；闰年2月及非零时首次交付不减正常整月费。
- [x] 运行 `pnpm --filter @chundian/api exec tsx --test test/v31-service-calendar.test.ts`，确认因尚无新规则而失败。
- [x] 实现共用日历与逐期四舍五入；末期从未履行时段算退款，避免首次非零交付改变整月价。移除所有首次/续期/准备/阶段的硬编码12校验，统一调用新校验。
- [x] 新建产品草稿页面建议 minimum=3、运营明确确认由任务10承接；后端发布要求显式值，不自动推定确认；旧版本不推定已有独立最短期限，不追溯改已签快照。旧测试订单清理前保持原始事实，转换区间时明确旧 inclusive end 到新 exclusive end，不直接加减一天猜测。
- [x] 重跑新测试及现有 billing、usage、order-renewals-context、product 相关测试，记录实际命令和结果；核对金额无浮点累计。只提交本任务文件。

## Task 2: 主体、合作和产品条件的资料来源

实施记录：2026-11-07 完成资料持久化、业务来源绑定、缺项定位及冻结校验；独立审阅发现的实际产品缺失与附件集合排序问题已修复并复审通过。最终针对性测试12/12、API构建通过，相关回归修复前42/42。任务3接准备/发起前冻结核验，任务5—8绑定其他业务类型，任务10挂载维护页面。

**Files:** Create `apps/api/src/contract-terms/types.ts`, `sources.ts`, `readiness.ts`; Modify `apps/api/src/partners/simple-agreements.ts`, `products/snapshot.ts`, `electronic-documents/identities.ts`, `electronic-documents/cooperation.ts`, `apps/api/prisma/schema.prisma`; Test `apps/api/test/v31-contract-sources.test.ts`（新）。

**Interfaces:** `resolveV31Sources(tx, context: V31Context): Promise<{snapshot: unknown; missing: MissingField[]}>`; `freezeV31Sources(input): {snapshot: unknown; hash: string}`。企业、产品、车辆来源均有 revision/hash；私密证件仅在授权渲染时解密，不落普通任务 JSON。

- [x] 写失败测试：三方企业/客户不混淆，合作商对公账户与电池出租方账户隔离；未知权利限制不填“无”；无另付BaaS为明确值、另付缺金额/对象拒绝；邮箱可空；合作产品/车辆/期间缺失返回可维护页面。
- [x] 运行 `pnpm --filter @chundian/api exec tsx --test test/v31-contract-sources.test.ts`，记录预期失败。
- [x] 复用现有身份、权属、保险、资格、附加产品来源，补常设联系人/住所/权限来源、对公账户核验、客户BaaS费用安排、明确合作/车辆期间、产品及模板授权范围。仅有例外时保存具体例外及证据。
- [x] 实现来源冻结与资料变更核验；资料刷新不能悄悄改变待签合同主体。合作默认时限使用本轮已确认值及审计来源；各真实产品条件、合作期间/比例/范围另取实际确认数据，不能借默认时限确认替代它们。
- [x] 测试通过后核查 DTO/鉴权/加密及缺项定位，一次维护可供六份文书复用。只提交本任务文件。

## Task 3: V3.1 模板族和完整 PDF 生成

实施记录：2026-11-07完成七件专用模板、47标记映射、真实01/02准备及不可变来源、61页合成PDF核验。独立审阅I1隐私问题已修复并复审通过：完整身份只进入受保护PDF，普通合同JSON不返回私有正文。任务最终35项通过，修复定向12项及API构建通过。正式源稿仍为DRAFT，后续种类绑定及正式审批由对应任务承接。

**Files:** Create `apps/api/src/contract-terms/template-map.ts`, `render-model.ts`; Modify `apps/api/src/electronic-documents/types.ts`, `print.ts`, `prepare.ts`, `policy.ts`; Sources `docs/legal/versions/ninda/`（批准后新增版本）；Test `apps/api/test/v31-contract-render.test.ts`（新）。

**Interfaces:** `buildV31Document(context, snapshot, template): {sections: unknown; roles: string[]; templateHash: string}` → existing `renderElectronicDocument` → `ContractArtifact`。七个任务正文：01、02主文+附1/2、02附3、03、04、05、06；00只作说明。

- [x] 写失败测试：47标记都有字段/控制区映射；4个“待填写”来自最短期限/比例；六合同甲乙丙正确；02多个产品最短3/6月逐项带入，不统一写3或任取单值；02独立授权不附在主任务内冒充已签；无例外不生成空栏；未审批正文不可签；缺关键资料阻止生成。
- [x] 运行 `pnpm --filter @chundian/api exec tsx --test test/v31-contract-render.test.ts`，确认红灯。
- [x] 为各kind明确模板映射，不再共用通用ORDER_AMENDMENT/TERMINATION正文；保留全部条款、附录顺序、加粗提示及独立签署区。02不同产品最短期限场景按设计5.2提出的固定明细表达出样张确认，不擅改正文含义。源ZIP条目及文本哈希、模板批准版本写入发布证据。
- [x] 生成合成样张：长企业名、多人身份、几十辆合作清单、跨页表格、BaaS另付/无、保险已出单/真实待出单、无例外/有例外。渲染每页核对条款完整、金额/身份可读、签章定位不遮内容，签署页和自动填值不能残留审阅说明。
- [x] 通过单测及全页视觉核验；正式正文和样张经已授权审批路径启用，未批准的新正文维持DRAFT。只提交任务文件和合成证据。

## Task 4: 真实签署时间、最终验签与安全停止

实施记录：2026-11-07 完成并通过独立审阅及两轮修复，原4项Important及新增回调独立补证问题均关闭。最终窄修复22/22、API构建通过；前轮40/40含实际Windows文件权限验证。实现原交易真实时间、精确PDF验签、独立停派证据保全与公平重试。真实渠道关闭、账号及格式兼容仍待任务11受控验收；当前无法证明外部关闭时明确NEEDS_REVIEW，不宣称旧链接失效。两个既有交接/换车测试夹具问题由后续业务任务及整体测试承接。

**Files:** Modify `apps/api/src/esign/fadada/fadada-api.client.ts`, `esign/fadada-query-binding.ts`, `electronic-documents/provider.ts`, `service.ts`, `archive.ts`, `proof.ts`, `types.ts`, `reconciliation.ts`, `apps/api/prisma/schema.prisma`; Test `apps/api/test/v31-electronic-proof.test.ts`（新）。

**Interfaces:** `querySigner` 返回 status/evidenceHash 及经核验的 providerSignedAt；`verifyFinalFile(task, bytes)` 返回预期主体匹配、完整性及时间戳证据；`stopSigning(taskId, revision)` 返回 `STOPPED_LOCAL_ONLY | PROVIDER_CLOSED | NEEDS_REVIEW`，关闭完成要有真实渠道证据，不能直接宣称法律解除。新增 `captureStoppedSigningEvidence(tx, taskId, proof): {evidenceId: string; finalFileId: string}`，只保全证据、不调用业务激活。

- [x] 写失败测试：3000缺真实endTime不以now补值；核验晚于签署不改变生效日；异常未来时间/错绑定拒绝；签章数多于人数可按主体正确映射，错主体/篡改拒绝；已接受超时不得新交易重签；本地停止后旧外部完整签署到达，能保全/下载最终文件，但不调afterArchive、不更新currentApprovedVersionId、不激活合作/订单/续期，重放不重复建证据。
- [x] 运行 `pnpm --filter @chundian/api exec tsx --test test/v31-electronic-proof.test.ts`，确认新约束未满足。
- [x] 接通官方2.0的query_sign_result.endTime及contract_verify证据，保留现有可信主机/请求绑定/回调验签和幂等；签署核验、合同法律生效、归档完成分字段记录。
- [x] 增加安全停止状态。先停新派发并锁版本，查询所有已接受交易，再用已经核实的渠道能力关闭；拒签接口的前提不能忽略。渠道能力未核实时保持NEEDS_REVIEW、阻止冲突新版本发布，不能删除历史成功签署。
- [x] 实现独立证据保全：停派任务核实已完整有效签署时，下载/验签、保存原版本及真实归档回执、授权各方取件，记录证据状态而非放开正常业务归档钩子。同步修改 `docs/api/electronic-documents.md` 的撤回/归档及文件可用性契约；无效或错绑定文件只隔离，不能对客户显示签约已成立。
- [x] 测试晚回调、重复回调、停派与自动签并发、归档超时恢复；所有失败不回滚已核实事实。只提交本任务文件。

## Task 5: 首次订阅与实际交付起租

**Files:** Modify `apps/api/src/applications/applications.ts`, `electronic-documents/prepare.ts`, `subscription.ts`, `integration.ts`, `operations/online-handover.ts`, `usage/rules.ts`, `order-service-stages/initial.ts`, `orders/order-process-handover.ts`; Test `apps/api/test/v31-subscription-start.test.ts`（新）。

**Interfaces:** `prepareSubscription(orderId, revision)` 使用任务2/3快照；`activateInitialService(tx, orderId, actualDeliveryEventId)` 消费任务1日历，在原有交付事务内幂等生效。

- [x] 写失败测试：未实名可申请不可签；完整三方签署/归档后进首期资金；已支付首期和押金后只等待交付；计划11/10、实际11/12，不重签不重收，起租为11/12；同一交付事件重放不重复账单和权益。
- [x] 运行 `pnpm --filter @chundian/api exec tsx --test test/v31-subscription-start.test.ts`，确认红灯。
- [x] 把新订单主入口接到ELECTRONIC准备/签署，清除新单纸质上传审核门槛。签前只固化计划和实际起租规则；首期预付款没有虚假已发生服务期间，实际交付归属后补履约记录而非改PDF。
- [x] 实际交付前验证真实有效保单、客户资格、法大大实名、员工接收/交付权限、资金；合同已生效但归档失败显示真实状态并重试，不能误导为未签。
- [x] 测试幂等交付、换操作人、被作废版本、支付失败和迟到回调；只提交本任务文件。

实施记录：首轮独立审阅及一轮修复已通过；真实默认值→HTTP报价→V3.1 PDF补齐计划交付日期，实际交付范围验证与起租幂等均有证据。最终窄集成5/5、单元4/4、API构建通过；实际数据库测试使用项目隔离守卫运行器。端到端真实渠道和发布配置仍由任务11验收，无生产变更或提交。

## Task 6: 合作协议与独立用印授权

**Files:** Create `apps/api/src/electronic-documents/seal-authorization.ts`; Modify `electronic-documents/authorization.ts`, `policy.ts`, `cooperation.ts`, `prepare.ts`, `integration.ts`, `owner-signing/authorization.ts`, `apps/api/prisma/schema.prisma`; Test `apps/api/test/v31-cooperation-authority.test.ts`（新）。

**Interfaces:** `evaluateV31AutoGrant(party, context, now)` 接收明确cooperation/version/vehicle/product/template/amount/term/rights范围及签后独立授权、渠道状态；返回allowed/reasons。不能用null范围表示全部未来产品。

- [x] 写失败测试：只有主合作签章不可自动签；独立授权已签但渠道未授权不可自动签；产品换版、模板换版、超价/超期/车辆换商拒绝；03—06始终手签；任一企业欠授权时未派发任务双企业手签；撤权与派发竞争以锁及实时条件阻止越权。
- [x] 运行 `pnpm --filter @chundian/api exec tsx --test test/v31-cooperation-authority.test.ts`，确认红灯。
- [x] 实现合作与授权两个独立任务；各自法律生效事实、归档和业务期间分离。独立授权只建立明确范围，不能激活合作关系。合作变更/终止模板尚缺时返回明确不可办原因，不使用旧正文。
- [x] 根据当前渠道样本核对受权人为宁达、企业印章/证书及通知路由；无法证明时保持手签或阻止该受影响渠道。主控给定真实范围后才发出真实授权请求。
- [x] 测试部分企业已签后撤权只停止后续自动动作；已签不重复，未签人工续办，冲突条件需任务4关闭机制。只提交本任务文件。

验收记录：Task6及fix1独立复审通过；真实渠道/内部原始授权/正式样张接受由Task11受控核验，当前未发起真实授权或签章。

## Task 7: 同商换车电子补充协议与事实结算

**Files:** Modify `apps/api/src/vehicle-changes/offline-pricing-input.ts`, `offline-quote-preview.ts`, `upgrade-pricing.ts`, `handovers.ts`, `order-service-stages/swap-source.ts`, `electronic-documents/prepare.ts`, `integration.ts`; Create `apps/api/src/contract-terms/swap.ts`; Test `apps/api/test/v31-swap-settlement.test.ts`（新）。

**Interfaces:** `freezeSwapTerms` 冻结价格/产品/原押金/原期/计算公式；`settleSwapFacts(tx, swapId, returnEventId, deliveryEventId)` 输出逐期差价、已收抵用、间隔减租、应补退和权益消费，不改变原签快照。

- [x] 写失败测试：跨商/降级/改押金拒绝；价格不变实际交付晚2天只重算事实；旧车收回后无车间隔不重复收租；赠送次数只新车实际交付消耗，未完成释放预占；单次服务费不混入可分润升级差价。
- [x] 运行 `pnpm --filter @chundian/api exec tsx --test test/v31-swap-settlement.test.ts`。
- [x] 接入独立03模板、三方手签、原价已付抵入和月费差额按各服务月实际天数四舍五入。移除仅实际日期变化就SWAP_DATE_AMENDMENT_REQUIRED的分支，保留真实商业方案变动的重确认/新文书约束。
- [x] 同时接通旧车收回与新车交付的独立事实、客户核对实际差价/应补退；已部分履行失败不能直接取消抹掉交接证据。
- [x] 测试差价退款时钟、重复交接、服务月边界和实际付款归属；只提交本任务文件。

实施记录：Task7首轮独立审阅及fix1限定复审已通过。实际同价迟交、升级补差支付、完整无车月份三场景有数据库命令证据；同金额异议追加确认的版本链修复后，两条完整场景及最终API构建通过。012—014仅应用于守卫本地测试库；实际资金、渠道和页面尚不等同上线验收。部分履行后终止由任务8接续，退款/已结更正/事实升级租金分润由任务9接续，四端页面由任务10接续。无提交或生产操作。

## Task 8: 续期、交付前取消和协商终止文书

**Files:** Create `apps/api/src/contract-terms/renewal.ts`, `cancellation.ts`, `termination.ts`, `apps/api/src/order-renewals/cancellation-correction.ts`; Modify `apps/api/src/order-renewals/context.ts`, `effective.ts`, `activation.ts`, `cancellation-facts.ts`, `cancellation-policy.ts`, `cancellation-state.ts`, `orders/cancellation-facts.ts`, `offline-documents/termination.ts`, `usage/returns.ts`, `electronic-documents/prepare.ts`, `integration.ts`; Test `apps/api/test/v31-lifecycle-agreements.test.ts`（新）。

**Interfaces:** `resolveRenewalTerms`, `resolvePreDeliveryCancellation`, `resolveTerminationTerms` 产出任务2/3格式快照；`evaluateServiceEffect(facts)` 区分文书生效/新阶段开始/取消合意/收车/终止；`correctRenewalAfterLateAgreement(tx, cancellationId, revision)` 按已核实真实合意和独立履约事实形成纠正，不受仅技术ACTIVE/空期间拦截。

- [x] 写失败测试：01-31原单04-30续期仍05-31边界；新期签署不提前发权益；起日前真实双方取消、起日后核实和退款仍不启新期；无真实双方证据不能把单方申请当取消。
- [x] 追加失败测试：系统已自动ACTIVE并创建空usagePeriod/赠送额度后，晚核实有效期前合意仍可纠正为新期未生效；未付账单停收、已收全退、未用赠送作废留痕。已有真实读数/交接/消费不删除、不直接当新期有效、不从全退新期款扣抵，独立依赖事项待核。纠正与激活/迟到款竞争只产生一次结果。
- [x] 追加失败测试：04拒绝已实际交付及单纯未来续期取消；允许有证据且已确认独立费用的净退款而非强迫全退，但不默认准备费；06个人原因补偿封顶剩余租金，违约/法定原因不自动收费；普通末期2800分、28天服务月未履行12.5天退款1250分，不按整月收费。
- [x] 按8a—8e拆分执行实际定向测试及受影响回归；精确命令和结果见各子任务报告。原拟定单文件 `v31-lifecycle-agreements.test.ts` 未作为实际测试命令运行，不将其计作通过。
- [x] 分别接04/05/06电子文书和实际业务钩子，拆掉纸质归档前置条件；纯计划变化不要求DELIVERY_DELAY文书；正常到期不用06。法定单方解除按已有实际通知/依据核验路径办理，未支持时显示具体待核，不强迫三方另签才允许真实收车。
- [x] 实现普通默认时点推导，有真实例外才维护例外；实际收车/里程等不进入可变签前哈希。未开始续期取消按05处理，不要求额外旧纸质取消文书。
- [x] 实现期前合意晚到案的收件/核验/纠正。待核暂停该争议续期新增计费和自动新权益，保留原合同必要服务；确认后取消未来应收效力、释放未交付预占，形成冲正事件而非删账或回写历史事实。新期实收全退与真实额外履约争议分开。
- [x] 测试新旧阶段价格/权益/押金隔离、争议收车、原期末边界和晚到资金；未执行 Git 提交。

任务8执行拆分（原需求全部保留，按顺序实施并分别独立审阅）：

- [x] 8a：05电子续期的真实报价、签署、排期、资金与服务期生效链；原日历、新旧权益和押金隔离。2026-11-08独立审查Spec/Quality通过，0项发现；真实01→05及01→03→05本地证据、列表投影和63个定向用例完成，非生产签章验收。
- [x] 8b：真实期前取消合意的提交、核验、晚到纠正与新增阶段资金/履约依赖处理；不另造旧纸质取消前置。2026-11-08独立审查一轮修复后Spec/Quality通过；真实期前合意、技术激活纠正、迟到实收原路退款及驳回后重新关联服务期有本地命令证据。工作日/完整财务集成属任务9，旧纸写入口退役及相关旧测试改造属任务11，非生产验收。
- [x] 8c：04首次交付前取消，独立费用证据、净退款来源和真实电子签办理。2026-11-08独立审查及fix1复审通过；三方手签、真实早期合意、分离的资金观察与历史归档有本地命令证据，拒绝取消后普通退款回归已修复。017—019仅守卫测试库应用；工作日及完整财务属任务9，页面/真实渠道与生产属后续验收。日志噪声小项M1由任务11处理。
- [x] 8d：06协商终止、合法单方解除/通知核验、普通及部分换车实际收车、未履行期间计算和未用预占释放。2026-11-08独立审查及fix1复审通过；迟到归档、正式还车来源补全、金额首确认时钟和异议投影4项均关闭。020—024仅守卫测试库应用，最终影响组20项、补测3项及构建通过；真实财务闭合/异议处置由9承接，四端及渠道由10/11验收。
- [x] 8e：已生效电子续期内再次换车的实际集成；报价、事实结算、交付、服务期义务/用量分段、权益与有效合同链只作用于正确阶段，保留原期账款和历史。

2026-11-08：8a—8e均通过各自独立Spec/Quality审阅，原任务8本地实现检查项按实际分段证据统一闭合。8e为0项发现，两个真实命令旅程与47项受影响检查、API构建均通过，无新增迁移或提交。退款工作日/现金/异议和财务最终关闭由任务9接通，四端由任务10接通，真实渠道、正式模板及生产验收由任务11完成；本项完成不代表这些后续验收已完成。

2026-11-08集成补充：8a实作与控制端定向追踪证实，电子05生效后再次换车仍会进入仅接纸质服务期的报价reader，电子交付也尚未限定新服务期的义务及用量范围。8e作为原“新旧阶段价格/权益/押金隔离”的实际消费者补齐，在8d后、任务9前单独实现及审阅；不增加商业规则，不把无主缺口留给最终验收。

## Task 9: 退款义务、保留金与合作结算规则

2026-11-08用户调整优先级：当前9b退款阶段完成明确验收后收口，先接通已稳定接口的合同工作区、实名及签署主链并提前真实渠道验证。9c/9d的复杂自动处理暂缓；异常采用证据留存、防重复付款、可办理人工复核。后续新增项须标注合同条款、可复现缺陷或明确上线阻塞。执行以本计划SDD目录 `user-priority-2026-11-08.md` 为准，覆盖下文原顺序，不重做已完成任务。

**Files:** Create `apps/api/src/settlement-obligations/types.ts`, `calendar.ts`, `refunds.ts`, `deposit-cases.ts`, `cooperation-policy.ts`; Modify `apps/api/src/billing/renewal-cancellation-refunds.ts`, `partners/simple-revenue.ts`, `apps/api/prisma/schema.prisma`; Test `apps/api/test/v31-refund-obligations.test.ts`（新）。

**Interfaces:** `createRefundObligation(tx, facts, policyVersion)` 生成deadline/amount/liableParty/paymentRefs；`dueWorkingDay(triggerAt, count, calendarVersion)`；`settleDepositDebt(tx, caseId, debtId, amount)` 幂等同债关联。复用现有真实退款提交/查询，不建替代资金账。

- [ ] 写失败测试：3/7工作日含调休，不按简单周末；派发退款不记到账；失败重试不延长原截止；内部复核晚完成不改起算；合作商没补款不隐去客户应退款；无争议新期全退不被旧期损伤抵扣。
- [ ] 追加失败测试：保留金只针对真实案件，超额/无证据/无释放日拒绝；释放与扣抵不重复；押金不入分润；升级差价入租金分润而换车服务费不入；默认5/15等工作日及单协议例外版本冻结。
- [ ] 运行 `pnpm --filter @chundian/api exec tsx --test test/v31-refund-obligations.test.ts`。
- [ ] 实现退款义务、资金复核、异常通知及本人替代账户核验。工作日建议从触发次日开始计数、截止当日23:59:59上海时间，作为实施口径随方案确认，日历缺年份时不能猜测。签前不制造未来保留金或未来成功流水。
- [ ] 合作统计已有部分升级差价支持，补清收费项目归属；经确认的自然月5/15工作日规则、2/3/10时限形成规则版本和到期待办。首轮不自动转账给合作商，财务按有效规则核对支付并留凭证；既有规则模块不因此复活为复杂可编程规则引擎。
- [ ] 测试资金双人复核、部分退款并发、跨主体扣抵防护、退款失败/原路不可用；只提交任务文件。

2026-11-08执行拆分：在8a—8e全部审阅完成后，按以下四个阶段顺序实现、各自独立审阅，原任务9全部范围保留。具体入口及此前7/8交接责任见本计划SDD目录的 `task-9-decomposition.md` 和各阶段brief；不额外重复整个父任务审阅。

- [x] 9a：官方工作日历、真实来源绑定的退款义务与到期待办。2026-11-08完成本地接口与来源实现，独立审阅I1/I2修复后通过；初始10个不同用例有分别通过证据，fix1新增2项与直接影响3项通过、API构建通过。025/026迁移已核验。渠道实际执行仍属9b，最终结清及页面不据此宣称完成。
- [x] 9b：原路退款受理/到账/重试，以及客户本人替代账户和独立资金执行。2026-11-08本地阶段验收通过，I1—I4限定修复复审全部关闭，新增C0/I0/M0；默认原主链1/1、修复定向15/15、修复自包含6/6和最终API构建有分别通过证据。异常有补证/责任人/独立复核而资金未决限制不清除。详见SDD目录task-9b-stage-acceptance.md；本阶段收口，真实渠道及页面验证另行，不声称生产发布。
- [ ] 9c（暂缓自动施工）：真实押金保留案件、同债扣抵及已结算收车更正；仅在有条款/复现缺陷/上线阻塞依据时拆出最小必要办理，不作为实名签署提前接通的前置。
- [ ] 9d（暂缓自动施工）：实际租金/费用分润及合作结算；保留既有证据与限制，后续按明确依据准入，不自动扩展。

各阶段有实际工作区基线、定向红绿证据及权限/来源/资金审阅；不提前开始任务9，不把计算辅助函数当作可办理流程，不新建替代资金账。任务11与最终整体审阅核对跨阶段结果。

## Task 10: 四端页面、通知与线上交接

**2026-11-07 补充需求（已批准）：** 订单详情“主合同”页改为订单生命周期合同管理入口，展示主订阅、换车、续期、取消、终止及相关历史版本；参考车辆详情“商品展示”页的概况、记录列表、选中详情与办理区域布局。签署、法律生效、归档、业务推进状态分别显示；实名、主体资料、授权范围、签署和归档等门禁说明具体缺项，并定位到有权限的办理页面。未授权用户显示原因，不暴露签署凭据或绕过权限。合作协议可作为依赖关联查看，不冒充订单自身合同。

订单列表至少包含订单号、客户、车辆信息（明确当前使用车辆；换车未交付时仍显示当前车辆）、订阅产品名称、期限、月费、订单状态、创建时间。车辆展示车牌、品牌车型、VIN；产品、月费、期限取当前生效服务期，尚未开始取已确认方案，不从可变商品现价回填。顶部搜索在服务端按客户名、车牌号、VIN、订单号模糊匹配，支持分页、权限隔离和空结果，替换仅筛当前页的行为。

**Files:** Modify `apps/admin/src/App.tsx`, `order-workspace.tsx`, `order-contract-panel.tsx`; Create `apps/admin/src/electronic-documents/`（页面及来源跳转）；Modify `apps/signing-h5/src/owner/SimpleWorkspace.tsx` 及现有OwnerApp挂载、`apps/miniprogram`当前实名/订单/合同/交接页面；API `operations/online-handover.ts`, `field-handover/service.ts`, `orders/customer-handover-view.ts`。具体小程序路径实施前以当前app.json与审阅清单核对，禁止改原样副本。

**Interfaces:** 复用 `admin/customer/owner-h5/.../electronic-documents` 路由族；新增readiness为缺项列表，展示签署/归档/资金/实际交付独立状态。新增字段和枚举同步 `docs/api-contract.md`、`docs/api/electronic-documents.md`。

- [ ] 写页面行为测试：当前路由可达、只读合作商无签署按钮、企业有权人员不能越主体；完成交接不再保留确认勾选；未签无签后下载，已签但归档失败显示等待归档；费用和服务期间不混淆。
- [ ] 增加订单合同工作区与订单查询行为测试：生命周期文书及版本完整、门禁定位准确、签署事实与归档/生效独立；搜索跨分页生效，当前车辆/产品/费用随已生效阶段更新，旧车及拟换新车不混标。
- [ ] 新产品草稿独立显示最短月数，建议3，由运营明确确认后发布；实际订阅月数独立显示，旧版本缺失最短期限不得回填。任务1后端已提供minimumTermMonths及严格发布校验。
- [ ] 用项目各包现有测试命令确认新行为先失败，再挂载新工作台并替换纸质上传、人工签署归档及旧授权入口。保留既定PC布局和小程序视觉。
- [ ] 四类交接统一在线证据，不以contractMode不同退回纸签；客户确认要求法大大实名及当前冻结证据版本，员工用实名账号/权限记录。收车事实、客户争议和费用承认分别展示。
- [ ] 宁达业务通知留存内容版本、约定渠道和到达证据；短信/小程序消息不把发送成功等同收到/同意。渠道回跳只触发同步，不直接成功。
- [ ] 运行各包类型检查/相关测试并浏览器核验实际路由，真实小程序验证跳转、返回和PDF查看；只提交任务文件。

### Task 10a: 订单列表字段与服务端搜索（独立子任务，任务2后先行）

实施记录：2026-11-07 完成并通过独立审阅及两轮窄修复。服务端搜索与八列页面已接通；实际车辆交接证据、续期后换车版本链及现场时间偏差均有回归。最终接口测试2/2、管理端模型2/2、类型检查和API构建通过，本地浏览器1440/1920/390展示及11次查询交互通过。整体套件与实际渠道由任务11验收，生命周期合同工作区仍属任务10。

**Files:** Create `apps/api/src/orders/admin-query.ts`、相应API行为测试、`apps/admin/src/order-list-model.ts`及行为测试；Modify `apps/api/src/operations/admin.ts`、`apps/admin/src/resources.ts`、`App.tsx`及当前表格渲染组件/样式（按实际实现最小改动）、`docs/api-contract.md`。

- [x] 用失败测试覆盖客户名、车牌、VIN、订单号大小写不敏感模糊搜索，筛选先于分页，返回total准确、排序稳定；非法参数与无权限拒绝。
- [x] 订单号、客户、车辆信息、订阅产品名称、期限、月费、订单状态、创建时间全部可读。车辆信息包含车牌/品牌车型/VIN；明确当前车辆，待换未交付不切换，已完成换车后使用实际新车。订单已结束时显示最后实际用车，不误用最新创建的待交付车辆。
- [x] 产品/月费/期限取当前生效阶段及有效条款，未起租取已确认方案；未来续期不抢占当前值，缺失值明确待核，不取可变商品现价伪造历史。保留客户归属/RBAC及敏感字段过滤，查询只读。
- [x] 保留列表URL搜索/分页与返回位置；输入提示明确支持四类关键字，回车/搜索按钮生效、清空恢复第一页、空结果与请求失败可恢复；沿用后台蓝色主按钮及现有布局。
- [x] 运行API相关行为测试、管理端模型测试/类型检查，浏览器查看真实表格与查询交互；不把此子任务完成等同于合同工作区或四端电子签完成。

该子任务没有对任务3—9的依赖；先行能交付用户新增的独立列表改进。任务10剩余合同工作区、H5/小程序/交接仍在文书与履约接口完成后实施。

### 任务10剩余施工分段（同一已批准范围，顺序实施）

依2026-11-08用户调整，9b验收后直接推进10b—10e的合同/实名/签署主链，复用已稳定1—8/9a/9b接口；原要求等待9d的依赖已取消。复杂财务页面先提供真实证据、状态及人工复核入口，不为页面自动实现暂缓算法。渠道验证准备与主链接通同步提前，真实签章/交易仍按具体范围办理。

- [x] 10b：完整生命周期文书/门禁/通知证据接口与已收车待换车期间的真实列表来源。
- [ ] 10c：PC实际合同工作区、资料维护、生命周期及财务办理页面；保留10a列表和既定布局。
  - [x] 10c1：先接实际合同工作区、电子订单父流程和已验证动作。
  - [x] 10c2：接通初次签署必需的主体／合作范围／产品最低期限／报价事实维护（独立审阅通过；真实库及渠道验收归11）。
  - [ ] 10c3：其余既有生命周期及证据人工办理页面在早期真实渠道验证后按具体缺口推进；不新增9c/9d自动化。
- [x] 10d：企业有权人员签约H5及独立只读合作商H5，接通真实电子档案及授权办理（独立复审通过；真实渠道及明确剩余移动端/邀请表单验收归11）。
- [ ] 10e：小程序真实电子签路由与现场员工端，四类线上交接、客户事实/费用确认和通知展示。
  - [x] 10e1：先接客户初次实名／完整预览／签署／服务端核验返回／归档，以及已完成普通交接的入口清理。本地实现及fix1独立Spec/Quality通过；真实微信、渠道和候选切换由Task11验收，不等于父10e或生产发布完成。
  - [ ] 10e2：其余生命周期事实／金额／通知及现场端专门收回异议流程，在早期渠道验证后按具体缺口推进。

每段独立捕获实际修改基线并审阅；任务10原要求在全部子段完成后统一映射。任务11负责完整链路及真实渠道验收。

## Task 11: 受控切换与验收

**Files:** 新增 `docs/evidence/ninda-v31-acceptance-<实际日期>.json`、`docs/operations/ninda-v31-contracts.md`；复用现有测试业务重置及发布脚本，先审阅其范围。

- [ ] 按任务1—10逐项填写证据，模板版本/快照/最终PDF/通知/资金/交接可串联。运行 `pnpm --filter @chundian/api build` 及受影响端build/typecheck、相关回归；不把旧报告的通过数作为本次通过。
- [ ] 出具测试清理dry-run：明确申请/订单/纸档/合作纸协议ID和对象存储引用，车辆、合作档案、产品、实名和真实资金必要关联逐项保留；不进行宽范围生产删除。
- [ ] 完成供应商当前账号主体隔离、手签、自动授权、关闭旧流、通知及验签证据清单；未满足项目不写已完成。
- [ ] 明确真实验收三方/车辆/产品/金额/文书范围后，由本人完成实名和有效签章。测试正常与失效分支，记录准确版本和结果；资金复核独立。
- [ ] 全部通过后准备可回退发布包、数据库迁移和启用顺序。回退只回软件入口，不删除已有效签署/真实支付事实；真实资金异常有专门对账路径。按用户届时授权办理版本发布。

## 自审映射

### Task 11b: 已确认虚拟资产的初次电子签验收入口

**依据：** 用户已指定三方及月费100分×12期、押金100分，确认虚拟车及“仅用于实名、电子签、支付与归档验证，不形成真实车辆租赁或交付义务”。沿用Task11，正式签署前另审完整测试样张。

**范围：** 持久标记虚拟资产；服务端冻结单次验收参与方、资产/产品/押金/文书版本及测试说明；仅指定客户可进入，公共查询永不展示，禁止真实交付起租。测试文书如实列明无真实车辆及不适用资料，真实主体实名和签章证据照常核验；不得伪造VIN或把营业执照当车辆/保险/银行凭证。仅初次01/02-main/02-grant，不扩展金融自动化或03—06。

**代码边界：** 新增集中scope策略模块（具体模型/接口由下述定位步骤确定），最小修改`apps/api/src/catalog/`、`applications/`、`vehicles/`、`contract-terms/`、`electronic-documents/`及现有交付完成门禁；必要的单一Prisma迁移；指定客户测试入口和相关后台提示。固定已批准模板JSON字节保持不变。`docs/api-contract.md`同步实际接口。

- [ ] 定位真实CREATE/发布、公共及直接ID查询、报价申请/确认、source/prepare/print、交付起租路径；在所属SDD工作区写出带具体文件、签名和最少测试的技术设计，主控裁定后实现。
- [ ] 先写失败用例：无配置/过期/错客户/错版本/客户端伪造标识均拒绝；公共查询与直接ID永不泄漏，配置移除仍禁交付；普通车无行为变化。
- [ ] 实现持久标识、幂等受控创建和指定账号入口，绑定100分月费、12期、100分固定押金，保留订单/款项原有保护；不得代真实当事人实名或签章。
- [ ] 实现测试事实快照及醒目文书包装，完整原文/签署页均体现测试限制；将包装版本/内容hash绑定到签署来源，原模板仍逐字保留，真实个人信息不入源码或合成样张。
- [ ] 对精准改变运行本地HTTP/DB正负例和受影响端构建，生成完整合成样张并逐页视觉核对。发布候选与真实资料创建由主控独立控制；不得动线上1.2.1或待审/体验1.2.9。
- [ ] 冻结实际dirty-tree基线差分及证据，独立Spec/Quality审阅。完整样张交用户核对前，不发起真实签章。

设计4—5节→任务2/3/10；服务日历→1/5；03→7；04/05/06→8；退款和合作账期→9；实名/渠道隔离→4/6/11；独立授权→3/6；模板缺口→3/6/8；四端及线上交接→10；真实资金保留与发布→11。合作默认时限已确认，资料缺项、个别例外及供应商权限不通过代码假设填平。

### Task 11g: 企业中心三 Tab 与认证完成后的办理流程

用户于2026-11-09批准三Tab方案并授权直接实施，沿用本计划的独立审阅与受控发布。Spec: `docs/superpowers/specs/2026-11-09-enterprise-center-workspace-design.md`。完整单任务要求在本计划工作区 `task-11g-brief.md`。

**Files:** owner-H5 LegalApp/模型/样式/必要小组件，API owner-h5/service、verification-display、owner-signing/identity 及直接相关测试。按用户同日补充，加入共享认证材料快照、真实资料维护入口失效处理、签署门禁、认证回调原流水绑定和三个现有后台表单的说明文案；禁止财务、数据库迁移、法务正文和其他无关改动。

**Interfaces:** 保留现有 owner detail、refresh、verification、seals/image、seal 以及合同/授权接口；新增安全认证完成事实投影，原签署可用性门禁不变。前端消费认证事实和既有 capability，真实印模展示后明确选章。

**Review Focus:** 已认证但证书陈旧/未知/过期仍不能重复实名；不同公司/印章的迟到响应不能污染当前页面；法大大返回可定位原公司和合同；已完成流程隐藏同意和启动控件；移动端/桌面沿用原企业中心视觉且无溢出。用户补充的公司/法人材料固定、变更后新认证、原用印暂停、旧回调与新流水并发隔离均须直接测试。

- [x] 捕获认证完成重复操作和当前React交互缺陷 RED。
- [x] 最小实现公司信息栏+三Tab、分阶段实名/印章、协议浮窗、服务端重复启动保护及材料变更重新认证。
- [x] 用直接受影响API测试和真实React合成流程覆盖上述输入，验证 GREEN；包含原流水回调交错的 RED/GREEN。
- [x] API/H5/admin构建，移动和桌面截图检查；冻结实际差异、来源哈希与可复用页面产物。fix2仅重建API，保持页面产物不变。
- [x] 独立 task review，处理本次差异的阻塞项；不提交混合历史工作区。
- [x] 主控正常受控发布到当前宁达平台，核对配置保持、线上资源、健康和迁移；真实本人操作仍由当事人完成。2026-11-09 发布 `20261109-v31-enterprise-workspace-fix2`，发布证据见 `docs/evidence/v31-enterprise-workspace-20261109.json`；本项完成不代表父 Task11 的真实三方签章、支付及归档验收完成。

### Task 11h: 个人资料简化、证件即时保存与实名身份固定

用户已确认姓名、手机号和身份证号实名后锁定，不建设更改入口。Spec: `docs/superpowers/specs/2026-11-09-customer-profile-verified-design.md`，本工作区 `task-11h-brief.md` 是完整单任务要求。继承已批准明朗原生样式。

- [x] 已实名姓名不可修改、可信脱敏字段和即时保存失败／冲突／会话隔离的直接 RED/GREEN；后续渠道状态降级仍保留身份锁定。
- [x] 按同轮补充拆为个人信息／证件资料两个 Tab；个人信息卡片实名角标、完成后隐藏认证按钮，证件文字查看与同排操作；移除通用保存按钮，保留补件明确提交。
- [x] 受影响 API、小程序 Page 与编译模板核验，手机宽度视觉检查和最终 Linux API 构建。fix1 定向 API34／UI76 通过。
- [x] 独立任务审阅及实际 dirty 基线差分／来源哈希冻结；I1／I2 在 fix1 关闭，不提交其他历史改动。
- [x] 主控 API 发布 `20261109-v31-profile-compact-fix1`，核对健康／迁移／资源与0971既有实名记录不变；结合 Task11i 生成新小程序预览（123来源文件前后核验），未上传开发版、未提交审核或发布微信生产版本。真人验收仍由用户继续。

### Task 11i: 我的页入口、个人资料页脚与续期分页整理

用户同轮明确要求姓名／手机号卡片右侧加箭头并直接进入个人资料，删除独立入口卡片；随后补充个人资料底部“联系客服”“退出账户”左右并列，去掉单独电话号码；续期分页页码不能挤为竖排，“延期交车方案”入口改为与页面一致的“订阅变更方案”。本工作区 `task-11i-brief.md` 为具体要求，沿用明朗原生样式。仅 mine 标签／模板／样式、profile 页脚、records 分页模板／样式，复用既有跳转／拨号／退出及分页逻辑。

- [x] 调整身份卡片／重复入口、页脚、续期分页与入口文案；现有编译及主控合成手机排版／跳转核对（12 状态，320／390，无溢出）。
- [x] 独立轻量审阅通过、差分冻结，与 Task11h 一并进入 `20261109-profile-compact-fix1` 新预览。证据 `docs/evidence/v31-profile-ui-preview-20261109.json`。
