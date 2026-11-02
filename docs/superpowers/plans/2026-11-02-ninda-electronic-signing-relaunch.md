# Ningda Electronic Signing Relaunch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用统一、可核验的三方／双方电子签替换人工纸质合同流程，完成四入口改造并按授权重置测试业务。

**Architecture:** 复用 API 2.0 适配、身份及文件存储能力，新增逐签署方电子任务。现有 `DocumentArchive/ArchiveVersion` 继续承载业务版本引用，但新增电子证据来源及强关联，电子版本不伪造人工审核字段；交易流程只依赖统一的已核验电子归档证明。旧纸质写接口、页面和业务办理能力退役。

**Tech Stack:** Node 24、TypeScript 5.9、NestJS 11、Prisma 6/PostgreSQL、React/Vite、微信原生 JS/WXML/WXSS，沿用仓库锁定依赖。

**Spec:** `docs/superpowers/specs/2026-11-02-ninda-electronic-signing-relaunch-design.md`，用户于 2026-11-02 批准。

## Global Constraints

- 仅写本项目，旧库不连接；法大大结构固定来源 `453da778dcfefd3727813179382490903644ef26`。
- 晓浪仅提供 API；不得成为协议主体／被授权人，不参与宁达通知、签约、备案或归档业务。
- 三方实名，客户／自然人本人逐份签署；企业自动签不具备符合要求的权限时，双方企业逐份手签。
- 线上四类交接不电子签；客户法大大实名，员工沿用实名员工账号。
- 金额整数分，RBAC／归属／修订／事务幂等／回调校验不可省略；资金继续双人复核。
- 保持明朗原生小程序和现有后台视觉、产品及交易规则；生产不回退 Mock。
- 测试只用 `scripts/run-mvp-api-tests.mjs` 限定的 loopback:55432/chundian_test；不打印凭据。
- 真实法律文本须用户审定，真实身份及签章由本人在明确范围操作；测试资料重置已授权，不重复索要相同批准。
- 根工作区含此前发布的大量未提交源码，以任务开始时实际文件为基线，不从 HEAD 重建或覆盖它们。只提交本任务独立新文件或可隔离的增量，不夹带其他文件。

## Review Focus

1. 自动签请求超时后收到回调：只能核验原交易，不能切换模式后再签一次（Task 1、4）。
2. 只有客户与出租方已签、宁达未签：付款及业务生效必须仍阻止（Task 1、6）。
3. 续期已约定期前取消，电子签／退款跨起租日：保持新阶段不生效，原期正常结算（Task 7）。
4. 已清理测试订单收到真实支付／退款或签章晚回调：财务可追溯，业务不可复活（Task 11）。
5. 合作商只读管理员持有效登录但并非法人：可查看授权内资料，不能发起实名授权或签署（Task 3、10）。

## 执行及文件边界

沿用当前 `codex/independent-miniapp-platform` 工作区，以项目内只读基线副本和逐文件哈希隔离本次改动；不使用会丢失现有未提交功能的干净 HEAD 工作树。主控连续实施，最终独立评审；用户已经批准实施，不增加执行方式确认。

新增核心目录 `apps/api/src/electronic-documents/`：

- `types.ts`：合同种类、角色、签署模式、任务与证据 DTO。
- `policy.ts`：参与方完整性、派发顺序、自动／手动选择、可办理动作。
- `proof.ts`：纯函数验证最终签署／备案／PDF 证据。
- `repository.ts`、`service.ts`：事务、持久意图、幂等及编排。
- `identities.ts`、`authorization.ts`：读取实际三方身份与授权，不接受客户端账号／印章注入。
- `provider.ts`：复用 Fadada 客户端，绑定查询、归档和签后 PDF。
- `prepare.ts`、`archive.ts`：批准文本／业务版本冻结和归档投影。
- `controller.ts`、`access.ts`、`projection.ts`：后台／客户／合作商隔离接口及统一状态。

测试按 `apps/api/test/electronic-*.test.ts` 拆分。执行日志、基线及任务 ledger 位于 `.runtime/ninda/esign-relaunch-20261102/`。

---

### Task 1: 三方状态及可信归档规则

**Files:** 新建 `electronic-documents/types.ts`、`policy.ts`、`proof.ts`；测试 `test/electronic-policy.test.ts`、`test/electronic-proof.test.ts`。

**Interfaces:**
- `requiredSignerRoles(kind: ElectronicDocumentKind): SignerRole[]`；订单为 CUSTOMER/OWNER/PLATFORM，合作协议为 OWNER/PLATFORM，禁止交接种类。
- `selectSigningModes(parties: SigningPartyInput[], now: Date, context: SigningContext): SigningModes`；按文件种类、平台主体、合作版本及车辆校验，企业能力不齐则双方 MANUAL，自然人始终 MANUAL。
- `nextSigningAction(task: ElectronicTaskFacts, now: Date): ElectronicAction`；先 CUSTOMER，再 OWNER，再 PLATFORM，未知请求先 QUERY。
- `assertElectronicArchiveProof(proof: ElectronicArchiveProof, expected: ElectronicBinding): void`；完整验证任务、主体、源文件、最终文件与全部逐方证据。

- [x] 写失败用例：缺宁达、重复角色、错交易／身份／源哈希、交接误入签署、超时只查询、自然人不能自动、授权撤销不抹签署事实、归档不能早于最后签署方。
- [x] 运行 `node scripts/run-mvp-api-tests.mjs test/electronic-policy.test.ts test/electronic-proof.test.ts`，确认因缺失能力失败。
- [x] 实现以上纯函数与明确错误码，不读环境、不调用供应商、不使用“角色数量够了”替代逐方匹配。
- [x] 同命令通过；补文件哈希固定后的源／最终 PDF 互换用例并验证。16 项通过，补充自然人自动签及企业缺章红绿验证。
- [x] 记录 Task 1 完成证据，提交独立新文件。

### Task 2: 持久化、版本绑定与电子归档桥接

**Files:** 修改 `apps/api/prisma/schema.prisma`，新增迁移 `apps/api/prisma/migrations/202611020001_electronic_signing/migration.sql`；新建 `repository.ts`、`archive.ts`；测试 `test/electronic-repository.test.ts`。

**Interfaces:**
- `ElectronicSigningTask` 强关联唯一 `ArchiveVersion`，可关联订单 `Contract` 或 `PartnerAgreementVersion`，保存 businessHash/sourceSha256/providerContractId、状态、租约、派发和归档事实。
- `ElectronicSigningParty` 按 taskId/role 唯一，交易号唯一，保存主体／证书／印章／授权快照和可信核验事实。
- `ArchiveVersion.executionMode` 与电子任务关系区分电子、纸质来源；现有业务版本引用继续有效，但电子证据不填写伪造 reviewedBy/partyChecks。
- `loadElectronicArchiveProof(tx, archiveVersionId): Promise<ElectronicArchiveProof | null>`、`finalizeElectronicArchive(tx, taskId): Promise<void>` 使用 Task 1。

- [ ] DB 失败用例：跨订单或跨合作商关联、同版本重复任务／重复交易、两个派发者竞争、未完整签署不得写 ARCHIVED。
- [ ] 运行新测试确认失败，再加迁移／模型／事务实现。
- [ ] 通过受保护本地迁移命令 `node scripts/run-mvp-api-tests.mjs --migrate`；生成 Prisma 后运行数据库测试及 API build。
- [ ] 验证重入不改 provider IDs、业务引用不会绑定另一归档版本；提交本任务增量并记录结果。

### Task 3: 三方身份、企业授权及申请时点

**Files:** 新建 `identities.ts`、`authorization.ts`；修改 `esign/customer-identity.ts`、`customers/identity-policy.ts`、`customers/profile.ts`、`owner-signing/identity.ts`、`owner-h5/service.ts`；测试 `electronic-identities.test.ts`。

**Interfaces:**
- `resolveSigningParties(tx, archiveVersionId): Promise<SigningPartyInput[]>` 从冻结业务主体加载当前有效实名、证书、印章。
- `readAutomaticSigningAuthority(tx, subject, kind, scope, now): Promise<AutoAuthorityEvidence | null>` 分别检查业务授权、渠道授权与企业实名。
- `requireElectronicCustomerIdentity(tx, customerId): Promise<CustomerIdentitySnapshot>` 用于签约／交接，不把提交申请与认证门槛捆绑。

- [ ] 失败测试：允许未实名提交合格资料申请，但阻止正式签约和交接；自然人合作商走个人实名；宁达与 API 公司不可互换；仅公司管理员无签署权限。
- [ ] 完成角色／法人绑定及自然人账户支持，复用原认证查询与加密，补齐授权范围和服务端配置核验记录。
- [ ] 验证每个外呼使用实际主体 ID，失效／姓名不符／未知证书不能签；相关身份、资格测试通过后记账。

### Task 4: 上传、逐方签署、回调与两层归档

**Files:** 新建 `provider.ts`、`service.ts`、`controller.ts`、`access.ts`；修改 `esign/fadada/fadada-api.client.ts`、`app.ts`、`auth/access.ts`、`auth/role-policy.ts`；测试 `electronic-provider.test.ts`、`electronic-service.test.ts`、`electronic-http.test.ts`。

**Interfaces:**
- `ElectronicProvider`：`upload`、`manualUrl`、`autoSign`、`querySigner`、`fileContract`、`downloadFinal`；输入必须含冻结 task/providerContract/party/transaction 绑定。
- `ElectronicDocumentService.prepare/start/sign/sync/withdraw`：所有写操作带 `revision`、`idempotencyKey`，本人 sign 另带 `sourceSha256` 和全文同意。
- 路由 `/admin/electronic-documents`、`/customer/electronic-documents`、`/owner-h5/owners/:ownerId/electronic-documents`；回调 `/callbacks/fadada-electronic-sign`。

- [ ] 写模拟渠道失败用例：乱序／伪造／重放、回跳非成功、上传未知、自动签未知不重发、半签不可归档、备案失败或下载失败只恢复原任务。
- [ ] 实现持久意图、查询绑定、租约和互斥，复用现有 SDK 参数签名；正式自动签必须同时满足 Task 3 及渠道主体核验。
- [ ] 验证 `contractFiling.api` 的显式成功结果，再读取最终 PDF；无备案编号不伪造编号。
- [ ] 验证 owner-h5 Cookie/Origin/CSRF、跨客户／跨企业／财务岗位拒绝签署、普通管理员审阅规则及归档文件 ACL。
- [ ] 通过新测试和现有 digest／query-binding／native-domain 回归，完成接口文档增量。

### Task 5: 正式文件准备与合作协议电子化

**Files:** 新建 `prepare.ts`、`projection.ts`；修改 `partners/simple-agreements.ts`、`partners/controller.ts`、`contract/contract-pdf-renderer.service.ts`、`offline-documents/print.ts` 中可复用的纯渲染逻辑；新建 `docs/legal/drafts/ninda/launch-20261102-electronic/` 下正式正文和样张；测试 `electronic-documents.test.ts`、`electronic-cooperation.test.ts`。

**Interfaces:** `prepareElectronicDocument(tx, {kind,resourceId,revision,actor}): Promise<{archiveVersionId,taskId}>`，冻结批准模板、实际当事人、方案、文件与页内签章坐标。

- [ ] 测试未批准文本、缺身份字段、跨车辆／比例变更、旧纸档冒充新协议均拒绝；合作协议只有双方签署并归档才 ACTIVE。
- [ ] 实现源 PDF 与附件固定，保留真实三方和合作条款；新建合作协议只保存草稿，不允许上传文件直接激活。
- [ ] 起草主合同、各类补充／终止／续期取消、合作协议、用印授权及相关实名告知，渲染检查并一次提交用户审定；未批准不启用正式版本。
- [ ] 验证电子签后合作关系、商品申请可用性、比例／车辆范围一致，已有配置保留。

### Task 6: 新订阅、首期资金与线上交接贯通

**Files:** 修改 `applications/applications.ts`、`orders/signatures.ts`、`orders/signature.service.ts`、`orders/readiness.ts`、`orders/order-process.ts`、`orders/customer-contract-view.ts`、`operations/online-handover.ts`、`operations/workflows.ts`、`field-handover/service.ts`、`billing/billing.ts`；测试 `electronic-subscription.test.ts`、`electronic-handover.test.ts`。

**Interfaces:** 当前新合同使用 `ELECTRONIC` 办理模式，与历史双签 ESIGN 区分；前端投影 `executionMode:'ESIGN'`。`contractReady` 等现有业务函数经 Task 2 核验新电子证据，不伪造纸档审核。

- [ ] 失败用例覆盖完整三方链路及缺任一方、未归档不能付款；已付款正确推进交付，不出现纸质上传阻塞。
- [ ] 新申请保留现有报价与资格审核，客户确认后生成新任务；退役旧双签对新订单的执行入口。
- [ ] 四类交接写入实名身份版本与证据版本，已完成只读；所有交接签章入口拒绝新请求。
- [ ] API HTTP 集成验证“申请→确认→实名→三方签署归档→支付→证据确认→实际交付”，模拟支付／签章无真实外呼。

### Task 7: 延期、换车、续期及终止贯通

**Files:** 修改 `order-changes/agreement-facts.ts`、`agreement-readiness.ts`、`service.ts`、`finance.ts`，`vehicle-changes/`、`order-renewals/`、`order-service-stages/`、`offline-documents/readiness.ts` 与 `termination*.ts` 内对应事实校验；测试 `electronic-amendments.test.ts`、`electronic-renewal-cancellation.test.ts`、`electronic-termination.test.ts`。

**Interfaces:** 现有 archiveVersion 引用绑定 Task 2 电子证据；`assertArchiveEvidence` 对电子版本只读真实电子证明，不走人工 review；既有商业计算和有效条款链保持。

- [ ] 测试继承原业务金额／期数／里程／次数规则，签后未收款或未实际交接不得提前生效。
- [ ] 改造模式选择及归档校验，逐类接入统一准备／签署／归档；不增加普通任意改价或跨出租方换车。
- [ ] 覆盖续期旧服务期不变、期前取消确认跨起租日、新期不激活、退款仍独立复核；覆盖终止与最终结算不可相互替代。
- [ ] 运行现有核心计费／计价纯测试和新集成测试，记录被正式替换的纸档专属测试范围。

### Task 8: PC 后台统一电子合同工作区

**Files:** 修改 `apps/admin/src/resources.ts`、`core.ts`、`App.tsx`、`contract-center.tsx`、`order-contract-panel.tsx`、`esign-ui.tsx`；新建 `electronic-contracts.ts`、`electronic-contracts-ui.tsx`、`electronic-contracts.test.ts`；移除纸质办理页面与动作注册。

**Interfaces:** 消费 Task 4/5 统一 DTO：`phase`、`parties[]`、`archive`、`businessState`、`actions[]`，动作包含 `enabled/reason/revision`，不在前端重新推测状态。

- [ ] 模型用例覆盖三方状态、未知结果提示、归档重试、无权签署和完成后无过程勾选框。
- [ ] 实现准备／审批、查看全文、待本人办理、查询／归档恢复、协议版本和权限提示；移除纸字签字件上传／审核入口。
- [ ] 构建及模拟 API 浏览器检查订单、合作商、合同中心与异常态；保持已有导航、蓝色主按钮和页内标签。

### Task 9: 小程序实名与签署体验

**Files:** 修改 `apps/miniprogram/src/services/` 当前合同／实名请求、`utils/customer-contract.js`、`utils/customer-handover.js` 和对应 profile、contract、order、handover 页面；新增语义测试与验证记录。

**Interfaces:** 本人实名沿用受控 native bridge；签署使用 Task 4 返回的一次性本人工具链接，返回只执行 sync，不本地置成功。

- [ ] 测试资料可申请但签署需实名、三方进度、拒签／过期／归档处理中、已完成只读、退出登录后旧异步结果丢弃。
- [ ] 更新四入口相关页面，删除纸质指引及上传签字件；保持明朗原生风格、账单事由和多产品车辆选择。
- [ ] 小程序单测、WXML/WXSS 编译与开发者工具四入口检查；生成待验收版本，不提前称为体验版或生产发布。

### Task 10: 合作商 H5 与员工端

**Files:** 修改 `apps/signing-h5/src/owner/{App,SimpleWorkspace,Enterprise,ContractPanel,AuthorityPanel}.tsx`、`owner/client.ts`、模型测试；修改 `apps/admin/src/field/` 及 `order-handover-panel.tsx`。

**Interfaces:** 公司管理员会话与有权签署人会话明确区分，签署路由仍由 Task 4 服务端核验当前法人关系；现场端不接电子合同签署。

- [ ] 测试多企业切换、旧请求迟到、只读管理员不能授权、本人确认协议版本、自动范围内无重复待办、手动回退逐份可办理。
- [ ] 替换 OfflineWorkspace／OfflineArchive 的业务入口，保留合作条款及车辆／分润查看；实名和授权显示独立事实。
- [ ] 两入口构建与浏览器验证；现场四类交接均无纸质和签章操作。

### Task 11: 测试资料重置与旧能力退役

**Files:** 新建 `scripts/ninda/electronic-reset-test-business.mjs` 及 API 内受限清理实现；增补 order/application 等只读退休标记迁移，修改活跃列表和调度过滤；测试 `electronic-reset.test.ts`、`electronic-retired-callbacks.test.ts`。

**Interfaces:** `buildResetManifest(tx, allowlistedIds)` 只读产生清单和摘要；`applyResetManifest(tx, manifest, expectedHash)` 核验修订后幂等执行。财务必需引用保留并从活跃业务及后续派发排除。

- [ ] 测试非清单记录不受影响、真实 Payment/Refund/DepositEntry 不删、不扣款／退款、共享文件不删、合作条款转草稿、车辆测试占用释放。
- [ ] 覆盖晚支付／退款回调可追溯及晚签署回调不能复活业务；结果未知的外呼映射保留。
- [ ] 完成本地预演、失败恢复及幂等验证；退役旧纸档写路由和按钮，保留必要只读财务引用。
- [ ] 仅在正式切换窗口备份并执行已授权的具体测试 ID 清单，不在开发过程中清理生产。

### Task 12: 全面核验、审阅及上线验收

**Files:** 更新 `docs/api-contract.md`、`docs/operations/` 操作说明、`docs/evidence/` 不含秘密的报告及本任务 release manifest。

- [ ] 构建 API、后台、两种 H5 和小程序，运行新电子签全套及未改变的支付／账单／计价／四入口回归。
- [ ] 对比基线完成独立全改动审阅，修复重要问题并补相应红绿测试；不将测试渠道回调模拟当真实电子签验收。
- [ ] 收齐正式文案批准及渠道主体／自动或手签证据；明确本人验收企业、车辆、文件和金额，不擅自用印。
- [ ] 完成备份、迁移／重置、后台与 API 发布和小程序体验验收；按已确认上线目标办理生产发布所需步骤并区分实际状态。
- [ ] 记录真实三方签署、归档、支付、线上交接、变更／终止／续期和合作协议验收结果；外部依赖未完成时准确列明，不宣称全量上线。

## 自检

设计第 1–5 节对应 Tasks 1–5；文件及状态设计对应 Tasks 1、2、4–7；四入口对应 Tasks 8–10；清理对应 Task 11；发布对应 Task 12。所有下游归档依赖统一 `ElectronicArchiveProof`，没有第二套双签完成入口。真实协议审定及本人用印是已批准方案中保留的真实业务步骤，不妨碍先完成可核验的本地代码。
