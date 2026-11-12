# 宁达线下签约、线上履约 MVP Implementation Plan

> 2026-10-27 更新：总施工入口调整为 [v2.1 七模块开发计划](2026-10-27-ninda-seven-module-mvp.md)。本文件 O01–O14 的复用、替换和依赖顺序按新版第 2 节执行，不再独立按旧企业范围和导航施工。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在客户小程序、企业车主 H5、后台及其 FIELD 界面跑通线下三方签约资料审核、订单、车辆查验交还、微信支付和结算退款，全旅程不依赖法大大账号或签章能力。

**Architecture:** 保留现有模块化单体及订单/支付/交接领域，新增独立线下档案版本和人工审核。新订单冻结 OFFLINE，历史订单保持 ESIGN；所有门禁按记录模式计算，人工归档不写电子签成功。普通工作区无供应商调用，历史恢复显式只核验。

**Tech Stack:** Node.js `>=22 <25`、`pnpm@11.7.0`、NestJS/TypeScript、Prisma/PostgreSQL、React/Vite、微信原生小程序、node:test、本地合成浏览器验证。

**Spec:** [v2.0 三端设计基线](../specs/2026-10-26-ninda-offline-contract-mvp-design.md)。先读该文档、AGENTS.md 和两份权威 API 契约。

日期：2026-10-26。版本：2.0。当前仅交付设计及实施计划，以下任务均未执行。本文替代 [旧 MVP 计划](2026-10-21-ninda-order-mvp.md) 的实施顺序；不执行其新增电子签/托管电子签任务。人员、资金和原样副本等不冲突要求已纳入本计划。

## Global Constraints

- 仅在本项目写入。旧仓库和旧数据库作为只读来源；禁止连接旧业务库做开发测试。
- 金额整数分；客户归属、后台 RBAC、版本冲突、事务幂等、支付回调校验不可省略。历史签署回调仍须验签和绑定原任务。
- 小程序原样副本不改写；真实版保持页面视觉，生产不回退 Mock。
- 法大大历史结构复用来源提交 `453da778dcfefd3727813179382490903644ef26`；本版不新增电子签执行，不读取落后的旧工作树替代历史来源。
- 密钥禁止输出/入 Git/入前端。真实支付、退款及历史签署处理需明确操作范围；本轮不执行。
- 并行人员只写分配目录；根安装、锁文件、schema、迁移、鉴权与应用注册由主控统一处理。不单独提交别人文件、不推送、不部署旧系统。
- 重要业务行为先测试，再实现和核验。采用现有 NestJS、Prisma/PostgreSQL、React/Vite、原生小程序，不引入新中间件。
- Node.js 为 `>=22 <25`，包管理器为 `pnpm@11.7.0`；依赖保持项目已锁定版本。
- 时间存储 ISO8601，业务日期与展示使用 Asia/Shanghai；分转元仅用于展示。
- 测试库仅本项目本地 loopback:55432/chundian_test；同一时刻一个 API 测试进程，不输出连接串。

## Review Focus

1. 文件齐全但少一方签章、换提交人自审、跨订单借文件：审核拒绝，不能进入付款，O04/O05。
2. 审核通过后条款/manifest变化，或审批、作废与付款/交车并发：同事务重验当前快照，可信已到账仍记账，O05/O06/O07。
3. 车已实际归还但客户拒绝确认或材料未齐：记录收车并暂停未来账单，不假结单、不让车重新上架，O07/O08。
4. 没有电子签凭据，或历史query/callback隐含自动盖章：新流程无渠道依赖，历史仅核验且签章调用为0，O01/O03/O12/O13。
5. 线下纸已签但扫描件未归档/被退回：取消不能按“电子签未签”直接释放车辆或遗漏终止文件，O08。

## 1. 已有代码与本轮差异

只读检查日期为2026-10-26；工作树已有多线程变更。没有运行产品测试或读取生产数据库，开工前重新核对文件归属与实际部署。

| 领域 | 已有实现 | 改动责任 |
| --- | --- | --- |
| 合同/模式 | Contract.status 与 Handover.signatureStatus 表示电子签 | O01/O04增加独立模式及档案，不能伪造SIGNED |
| 方案出租方 | `owner-signing/lessor.ts` 要求供应商实名、证书及章 | O03按OFFLINE选择人工业务资格，原ESIGN规则保留 |
| 收款 | `billing/billing.ts` 普通发布及pay没有统一主合同归档门禁 | O06覆盖发布、新建/复用支付参数及回调竞态 |
| 交付 | `orders/readiness.ts` 普通分支看SIGNED，effectiveTermsVersion分支直接看资金 | O06两分支都调用统一合同就绪；O07去除OFFLINE电子签条件 |
| 文件 | `files/files.ts` 已有10MiB、魔数、哈希及私有存储 | O04绑定档案/版本，O05封堵通用文件绕过 |
| 车主H5 | `owner/ContractPanel.tsx`、`Enterprise.tsx` 已有合同全文及手签 | O10复用阅读结构，替换导航/动作，不重复建电子签页 |
| 历史核验 | 普通provider query及部分owner callback可能自动盖章 | O12分离只核验路径，关闭全局发起并不足以代替调用链检查 |
| 员工入口 | 服务号“员工入口→车辆交接”已配置 | O11保留field.html，增加纸质单上传和独立审核 |

旧表结构/枚举与线上部署可能继续变化；迁移号下列为预留名，主控在实施前检查冲突并统一调整，不能覆盖其他线程迁移。

## 2. 里程碑与依赖

| 里程碑 | 任务 | 结果 |
| --- | --- | --- |
| M0 基础 | O01/O02/O03/O04/O05/O12 | 模式、权限、人工企业资格、档案审核、无新电子签 |
| M1 履约 | O06/O07/O08 | 合同归档收款、查验交还、异常收车、取消与退款 |
| M2 三端 | O09/O10/O11 | 客户、车主、后台/FIELD完整工作区 |
| M3 交付 | O13/O14 | 合成全旅程、受控发布及真机/支付验收 |

依赖：O01→O02/O04/O12；O02→O04；O04→O03；O03/O04→O05；O05→O06；O05/O06→O07；O06/O07→O08；O06/O07/O08→O09；O03/O05→O10；O02–O08→O11；O01–O12→O13→O14。实际基础执行顺序O01→O02→O04→O03→O05，编号保留；O04可建立草稿并绑定当前登记主体，审核资格与打印能力由O03/O05接续，不反向依赖O03。前端可在O01契约上写合成失败用例；实际集成须等依赖完成。

主控独占 schema/迁移、app.ts、auth/access.ts、API契约、根依赖和测试库。API同目录任务串行；小程序、车主H5、后台三个目录可独立并行。任务验收记录文件、接口、命令/退出码、评审和未完项；不提交他人文件、不用git add .。

## 3. 公共接口与文件职责

O01新增 `apps/api/src/offline-documents/types.ts`：ContractMode、ArchiveKind、ArchiveStatus、ArchiveSummary、ReviewChecklist、OfflineActor；字段和枚举严格按设计§7。`OfflineActor` 为 `{kind:'ADMIN',adminId,role,sessionId,authVersion}` / `{kind:'CUSTOMER',customerId}` / `{kind:'OWNER',customerId,ownerId}`，由服务端身份构造。FIELD使用ADMIN身份但仅专用任务服务授权。

统一接口：

```ts
// readiness.ts：接收事务tx；所有判断基于当前记录，禁止缓存通过结果。
contractReady(tx, orderId): Promise<{ready:boolean; archiveVersionId?:string; blockers:string[]}>;
handoverDocumentReady(tx, handoverId): Promise<{ready:boolean; archiveVersionId?:string; blockers:string[]}>;
// archive.service.ts：input 对应基线§7.2，写入含revision/idempotencyKey。
ArchiveService.create(actor,input): Promise<ArchiveDetail>;
ArchiveService.newVersion(actor,archiveId,input): Promise<ArchiveDetail>;
ArchiveService.submit(actor,archiveId,input): Promise<ArchiveDetail>;
ArchiveService.review(actor,archiveId,input): Promise<ArchiveDetail>;
ArchiveService.invalidate(actor,archiveId,input): Promise<ArchiveDetail>;
// workspace.service.ts：只读、白名单投影，不调用供应商。
OfflineWorkspaceService.get(actor,orderId): Promise<OrderWorkspace>;
OfflineWorkspaceService.list(actor,query): Promise<PageResult<WorkItem>>;
```

ArchiveDetail 为 ArchiveSummary＋当前授权可见版本元数据/文件清单/检查项；对外删除内部审核意见、人员信息及未归档版本。CreateInput固定kind/subjectType/subjectId/templateId/scopeSnapshot/idempotencyKey；服务端冻结三方及businessSnapshotHash，不接受客户端传入权威主体/金额摘要。VersionInput包含签署元数据、文件排序、revision/idempotencyKey；上传文件只能引用本草稿绑定记录。

工作区沿用v1.1字段，增加mode与线下合同投影；source、归档文件分别标识。新文件接口、固定动作code、错误码和分页严格使用设计§7.2。前端不得以原Contract.status或签署字段独自推导“可付款/可交车”。

## 4. 实施任务

### O01：契约、模式与安全测试入口

**Files：** 修改 `docs/api-contract.md`、`docs/api-owner-h5.md`、`apps/api/prisma/schema.prisma`、`apps/api/src/app.ts`、`apps/api/src/common/{config,gateways}.ts`、`apps/api/src/esign/esign.module.ts`、`.env.example`；新增 `apps/api/src/offline-documents/{types,mode}.ts`、迁移 `apps/api/prisma/migrations/202610260001_offline_document_mode/migration.sql`、`docs/fixtures/offline-mvp/{customer,owner,operations,finance,support,field}.json`、`scripts/run-mvp-api-tests.mjs`、`scripts/tests/mvp-test-target.test.mjs`、`apps/api/test/offline-mode.test.ts`。若安全入口已由其他任务完成，核验后复用。

**Interfaces：** 上述公共类型；`assertNewEsignAllowed(context):void`；FinalPlan.contractMode纳入commercialHash，新订单从客户确认的方案冻结OFFLINE、Contract/Handover继承同模式。入口 `node scripts/run-mvp-api-tests.mjs <test-file...|--all|--migrate>`。

- [x] 写安全入口断言：缺变量/非loopback/非55432/非chundian_test不得启动子进程，子进程DATABASE_URL必须等于已验证TEST_DATABASE_URL；锁冲突拒绝并行、退出释放，连接串不输出。先运行 `node --test scripts/tests/mvp-test-target.test.mjs` 得到预期失败。
- [x] 写 `new_order_freezes_offline_mode`、`existing_rows_remain_esign`、`flags_cannot_mutate_existing_mode`，验证FinalPlan模式/hash及确认时模式一致，AWAITING_CONTRACT_REVIEW仅新离线订单使用，旧订单及任务不批量转模式；`unknown_role_action_fails_closed`验证契约白名单。
- [x] 写 `offline_api_boots_without_fadada_credentials`：不配置任何法大大凭据仍可启动HTTP、登录及查询线下业务；历史恢复返回明确渠道不可用且保留状态。实现延迟适配器/不可用实现，不返回Mock成功。
- [x] 实现迁移和类型/安全入口：全量API串行、仅允许test/*.test.ts路径或--all/--migrate，迁移用本项目 `tsx src/common/migrate.ts --test`。实现新电子签总门禁，不改变旧可信回调验签条件。
- [x] 同步权威API文档并标记规划/完成状态；样例证明三方、整数分、字段裁剪、离线状态与电子签状态不混淆。接口全量路由登记为后续任务提供检查清单。
- [x] 运行安全入口单测、`node scripts/run-mvp-api-tests.mjs test/offline-mode.test.ts`、API build；预期退出码0，记录实际结果。

### O02：人员、固定角色及权限基础

**Files：** 新增 `apps/api/src/auth/{staff.types,staff.service,staff.controller,staff-session,role-policy,staff-command}.ts`、`apps/api/test/{admin-users,admin-rbac,admin-session-races}.test.ts`、迁移 `202610260002_staff_access_revision/migration.sql`；修改schema、`auth/{access,auth.controller}.ts`、`operations/admin.ts`、app.ts；UI由O11处理。

**Interfaces：** 固定ADMIN/OPERATIONS/FINANCE/SUPPORT/FIELD；StaffService.list/detail/create/rename/changeRole/setActive/resetPassword/revokeSessions及StaffUserView沿用[v1.1人员契约](../specs/2026-10-21-ninda-order-mvp-design.md)第3.3/3.4/7节，且仅继承人员部分；新增 `requireCurrentStaff(tx,actor,action)` 供审核/付款/交接事务重验。

- [x] 先写并运行 `node scripts/run-mvp-api-tests.mjs test/admin-users.test.ts test/admin-rbac.test.ts test/admin-session-races.test.ts`：旧PATCH绕过、五角色、未知动作、自审、最后管理员、改密/停用后多会话、旧密码并发登录及FIELD改派，记录新要求失败。
- [x] 实现revision/authVersion/updatedAt与StaffCommand事务，保留账号和历史归属；人员敏感动作独立路由、旧敏感PATCH拒绝、自锁和最后管理员保证、内部人员每次访问重验。密钥和密码处理按人员契约，不默认ADMIN、不返回密码。
- [x] 把归档/反馈/文件新资源加入明确白名单；财务/客服只读安全摘要，FIELD专用任务资源；审计不可通用PATCH，未知资源默认拒绝。内部上传者集合不能靠换角色绕过自审。
- [x] 重跑上组及 `test/auth.test.ts test/api.test.ts test/field-access.test.ts`，API build；逐项核对设计§4，记录O02。

### O03：人工企业资格、出租方快照与打印件

**Files：** 新增 `apps/api/src/owner-h5/{business-verification,offline-access}.ts`、`apps/api/src/offline-documents/{business-readiness,print-document}.ts`、`apps/api/test/{offline-owner-access,offline-print-document}.test.ts`、迁移 `202610260003_owner_business_verification/migration.sql`；修改schema、`applications/applications.ts`、`owner-signing/lessor.ts`、`owner-h5/{access,legal-representative,owners.controller}.ts`、app.ts，复用已审定LegalDocument及现有PDF渲染。

**Interfaces：** 依赖O04档案表及create草稿；`OwnerBusinessVerificationService.submit/review`；`buildOfflineLessorSnapshot(tx,ownerId,vehicleId,leaseRange)` 校验人工资格及有效合作档案；`prepareOfflinePrint(tx,subject,templateId)` 经基线prepare接口返回sourceFileId/sourceSha256/requiredSigners/businessSnapshotHash，不创建任何供应商任务。O03单测用合成已审档案fixture，O13全旅程必须走O05审核接口。

- [x] 写 `offline_owner_needs_no_provider_certificate`、`invite_or_sms_alone_does_not_verify_owner`、`changed_legal_profile_revokes_access`：无供应商凭据可办理，但跨企业、失效法人和未独立核验拒绝；已有电子认证记录不被篡改。
- [x] 写 `rental_print_has_three_frozen_parties`、`retired_pinned_template_remains_usable`、`cooperation_must_cover_vehicle_and_term`：新单仅用已批准模板，已冻结旧版本可履约，三方/车辆/金额/附件完整，未核验合作资料不能发布方案。
- [x] 先运行 `node scripts/run-mvp-api-tests.mjs test/offline-owner-access.test.ts test/offline-print-document.test.ts` 确认失败；实施模型及独立核验服务，按mode选择新/旧出租方逻辑。复用原模板审核/发布，打印件写订单/版本编号，不改正式正文或虚构审批。
- [x] 重跑同组及 `test/owner-legal-h5.test.ts test/owner-lessor.test.ts test/fadada-template.test.ts`，API build；验证整个OFFLINE资格路径无Fadada调用，记录O03。

### O04：线下档案版本与文件绑定

**Files：** 新增 `apps/api/src/offline-documents/{archive.service,archive.controller,files,command}.ts`、`apps/api/test/offline-archive.test.ts`、迁移 `202610260004_offline_archives/migration.sql`；修改schema、files/storage接口、app.ts。迁移包含DocumentArchive/ArchiveVersion/ArchiveFile/ArchiveFeedback/ArchiveCommand及基线唯一约束。

**Interfaces：** ArchiveService.create/newVersion/submit与设计§7.2 CRUD、版本/文件接口；archiveId/versionId/fileId三重绑定，文件当前来源记录不可由客户端指定。

- [x] 写 `uploaded_file_is_not_approved`、`cross_order_file_cannot_be_attached`、`submitted_version_is_immutable`、`rejected_resubmission_creates_version`；SHA相同也不能忽略归属，提交文件顺序固定，重复请求不生第二版。
- [x] 写 `archive_file_limits_and_type`：10MiB/文件、20文件/版本、50MiB总量，PDF/JPEG/PNG魔数，不可信扩展名；并发上传计数/总量在提交时再次校验，不产生半提交档案。
- [x] 运行 `node scripts/run-mvp-api-tests.mjs test/offline-archive.test.ts` 确认失败；实现专用上传与版本模型，复用物理存储但不能沿用泛用文件“customerId=null可引用”的授权。
- [x] 重跑同组及 `test/field-access.test.ts`、API build，记录原文件哈希/文件清单、幂等和并发校验，记录O04。

### O05：独立审核、反馈与统一工作区

**Files：** 新增 `apps/api/src/offline-documents/{review,readiness,projection,feedback,workspace.service,workspace.controller}.ts`、`apps/api/test/{offline-review,offline-workspace}.test.ts`；修改 `files/files.ts`、`operations/admin.ts`、`orders/customer.ts`、app.ts，封堵旧通用文件读取绕过。

**Interfaces：** ArchiveService.review/invalidate、contractReady/handoverDocumentReady、OfflineWorkspaceService；ReviewChecklist及错误码按基线，批准、当前版本指针及审计同事务。

- [x] 写 `missing_any_rental_party_blocks_review`、`uploader_or_submitter_cannot_review`、`stale_manifest_or_terms_blocks_approval`：三方任一partyChecks缺失/签章页引用错版/附件缺失/版本改变拒绝；换提交人或改角色不能绕过整个上传人集合。
- [x] 写 `approve_invalidate_pay_share_current_version`、`feedback_creates_stage_specific_hold`、`finance_support_cannot_read_archive_files`：并发审批无双有效指针，作废不抹历史，反馈按交付前/履约中区分门禁，所有旧下载入口一致授权。
- [x] 先运行 `node scripts/run-mvp-api-tests.mjs test/offline-review.test.ts test/offline-workspace.test.ts`；实现审核/反馈和只读投影，禁止向SignatureService提交人工成功，OFFLINE原电子签字段保持原义。
- [x] 重跑上组、API build；所有GET前后数据库业务事实不变、外部调用数0，引用档案与输出摘要一致，记录O05。

### O06：账单、支付及交付就绪

**Files：** 修改 `apps/api/src/billing/billing.ts`、`orders/readiness.ts`、账单生成相关usage服务；新增 `apps/api/test/offline-payment-gates.test.ts`。复用可信支付/退款回调与核验，不创建新支付系统。

**Interfaces：** 在发布账单、pay新建/复用参数、deliveryReady及advanceToHandover中调用contractReady；有效条款版本分支与普通分支一致，OFFLINE归档通过后从AWAITING_CONTRACT_REVIEW进入AWAITING_PAYMENT。

- [x] 写 `unapproved_contract_cannot_publish_or_pay`、`effective_terms_branch_cannot_skip_archive`、`deposit_and_first_rent_are_required`：包括绕过前端直接pay与已有支付参数复用；押金为0不造虚假账单。
- [x] 写 `late_verified_payment_survives_archive_invalidation`、`unknown_payment_recovers_original_transaction`：收到真实已匹配回调仍记账，但不交车；累计退款/净实收不重复计算。
- [x] 先运行 `node scripts/run-mvp-api-tests.mjs test/offline-payment-gates.test.ts test/payment-recovery.test.ts`；再实现同事务的版本/反馈检查与异常待办，不用人工付款成功开关。
- [x] 重跑同组及 `test/business-completion.test.ts`、API build；核对不同mode及已存在effectiveTermsVersionId路径，记录O06。

### O07：查验交还、纸质单和实物接收

**Files：** 修改 `apps/api/src/field-handover/{service,rules}.ts`、`operations/{workflows,handover-records}.ts`、`usage/{usage.service,ledger,returns}.ts`、`billing/billing.ts`（实施前核对当前账期生成调用点）；新增 `apps/api/src/offline-documents/{handover,vehicle-receipt}.ts`、`apps/api/test/offline-handover.test.ts`、迁移 `202610260005_vehicle_receipt_event/migration.sql`，主控维护schema。

**Interfaces：** FIELD专用offline-receipt/files与submit；`recordPhysicalReceipt(tx,actor,handoverId,input)`；complete对OFFLINE依赖customer confirmation＋handoverDocumentReady，保持车辆归属、款项和原manifest门禁。

- [x] 写 `inspection_confirmation_is_not_signed_contract`、`paper_receipt_must_match_current_manifest`、`reassignment_revokes_upload_and_files`：旧客户确认/旧纸质单不放行新版本，FIELD不审批/完成，交还两种任务覆盖。
- [x] 写 `physical_return_without_confirmation_pauses_future_bills`、`unpaid_return_can_be_recorded_but_not_closed`：已收车事件留下时间/位置/读数/证据，不自动完成交接或上架；账单生成/发布/pay均检查未来期间暂停，迟到可信到账仍记账。更正接口仅运营/管理员，previousEventId/revision保留原事件，数据库保证唯一当前修订。
- [x] 先运行 `node scripts/run-mvp-api-tests.mjs test/offline-handover.test.ts test/field-handover.test.ts test/field-access.test.ts`；实现离线完成门禁、FIELD上传、实物接收及未来账单暂停，保持usage已发生费用/争议账单，不按未核定日期自动减免。
- [x] 重跑上述及 `test/order-lifecycle.test.ts`，API build；交车/还车重复完成幂等，离岗待改派及历史证据保留，记录O07。

### O08：取消、终止、结算与退款闭环

**Files：** 修改 `apps/api/src/orders/order-actions.ts`、`usage/returns.ts`、`billing/billing.ts`；新增 `apps/api/src/offline-documents/cancellation.ts`、`apps/api/test/offline-cancellation-settlement.test.ts`、迁移 `202610260006_offline_cancellation_review/migration.sql`，主控维护schema及app.ts。

**Interfaces：** OfflineCancellationReview submit/review；既有cancel按当前模式检查独立审核和TERMINATION档案；returned/settlement/close仍使用现有资金与里程规则。

- [x] 写 `paper_signed_but_unarchived_cannot_cancel_as_unsigned`、`unknown_paper_status_blocks_cancellation`、`signed_order_requires_three_party_termination`：旧电子签字段DRAFT不是未签纸质合同证据；历史归档与UNSIGNED冲突拒绝，客户不能自填未签绕过。
- [x] 写 `future_bills_and_refunds_clear_before_completion`、`returned_vehicle_not_released_by_pending_archive`：应退未退/未知支付/未决争议不结单，真实收车和结算分别推进。
- [x] 先运行 `node scripts/run-mvp-api-tests.mjs test/offline-cancellation-settlement.test.ts`；实现审核/终止门禁、未来账单受控取消/退款；禁用本版自助换车/延期的新建，不删除原记录或放宽旧条件。
- [x] 重跑同组及 `test/business-completion.test.ts test/payment-recovery.test.ts`，API build，记录O08。

### O09：客户小程序订单中心与查验页面

**Files：** 新增/复用 `apps/miniprogram/src/pages/order-detail/index.{js,json,wxml,wxss}`、`tests/offline-order.test.cjs`；修改src/app.json、services/api.js、pages/{home,use,record,handover}/index.*；必要修改合同/支付路由映射，原样reference不动。

**Interfaces：** getOrderWorkspace/getWorkbench、归档读取/反馈、现有pay和查验confirm/object；只消费服务器capabilities。文案与流程按设计§3.1/6。

- [x] 写 `offline_order_has_no_sign_action`、`payment_waits_for_archive`、`inspection_confirmation_keeps_paper_step`、`archive_feedback_keeps_version`；旧签署深链对OFFLINE给明确替代入口，不调用sign。
- [x] 运行 `pnpm --filter @independent-platform/miniprogram exec node --test tests/offline-order.test.cjs` 确认失败，再实现订单分区、多订单、进度/补件/归档查看、付款与查验。
- [x] 实现401清敏感信息、409刷新重确认、重复点击抑制、断网恢复，合同问题反馈不是退款申请；删除新业务电子签引导但保留本人历史档案导航。
- [x] 运行该包test/check/compile:templates/build与 `node apps/miniprogram/scripts/verify-reference.cjs`，真机清单覆盖微信支付/文件阅读，记录O09。

### O10：车主 H5 业务工作台

**Files：** 修改 `apps/signing-h5/src/owner/{App,Enterprise,ContractPanel}.tsx`、model.ts、lifecycle.ts、style.css；新增同目录OfflineWorkspace.tsx、OfflineArchive.tsx、offline-workspace.test.ts及`scripts/qa-offline-owner.mjs`；后端列表/档案接口由O03/O05提供。

**Interfaces：** `/owner/#/owners/:ownerId/workbench|vehicles|orders|enterprise`，订单详情`#/owners/:ownerId/orders/:orderId`；保留现有入口域名，历史授权只读不新发起。

- [x] 写 `offline_business_view_needs_no_seal`、`company_switch_discards_old_archive_response`、`owner_sees_only_own_lessor_orders`：不展示认证选章为必办，切企业/退出后旧请求不能泄漏数据。
- [x] 运行 `pnpm --filter @chundian/signing-h5 exec node --experimental-strip-types --test src/owner/offline-workspace.test.ts` 确认失败；实现待办/车辆/订单/企业，复用全文阅读结构，提供线下办理说明/联系运营/归档反馈，不出现去法大大签署按钮。
- [x] 合成浏览器覆盖无订单/待线下/待审核/退回/归档/作废、跨企业403/404及375/430宽度，拒绝外网请求。
- [x] 运行该包test/build及 `pnpm --filter @chundian/signing-h5 exec node scripts/qa-offline-owner.mjs`，与现有企业登录/关系撤销回归，记录O10。

### O11：后台审核、人员管理与 FIELD 操作面板

**Files：** 修改 `apps/admin/src/{App,ui}.tsx`、`apps/admin/src/resources.ts`、`apps/admin/src/field/{App.tsx,client.ts,forms.ts}`；新增 `apps/admin/src/offline-archives.tsx`、offline-archives.ts、offline-archives.test.ts、users-page.tsx、users.ts、users.test.ts、account-settings.tsx、account-settings.test.ts、`apps/admin/scripts/qa-offline-admin.mjs`；已有同名文件先核验并增量修改。

**Interfaces：** 保留#orders?record=:id，新增#offline-archives及记录深链；人员#users，本人账户入口；FIELD仍field.html。订单工作区调用O05 API，不将文件上传成功等同审核。

- [x] 写 `three_party_checklist_and_file_order_are_visible`、`reviewer_cannot_approve_own_batch`、`review_409_requires_reload`、`field_only_uploads_assigned_receipt`；五角色菜单/动作/文件一致，审核展示当前快照及缺项。
- [x] 写人员UI用例：角色显式选择、启停/转岗/重置/撤销独立动作、401清密码/敏感详情、停用FIELD显示待改派；所有角色可本人改密，使用O02接口。
- [x] 运行 `pnpm --filter @chundian/admin exec node --experimental-strip-types --test src/offline-archives.test.ts src/users.test.ts src/account-settings.test.ts` 确认失败；实现队列/预览/上传排序/提交/独立审核/退回/作废及反馈处理，补齐订单、资金与交接分区。
- [x] FIELD增加纸质交接单材料栏与实物收车待核验操作；本人上传不可审，离岗/改派立即退回列表；运营完成动作显示缺哪份档案/确认/款项。
- [x] 运行后台test/build及 `pnpm --filter @chundian/admin exec node scripts/qa-offline-admin.mjs`，脚本本地静态服务＋合成拦截、拒绝外网，记录O11。

### O12：关闭新电子签并保留历史只核验恢复

**Files：** 修改 `apps/api/src/esign/{esign.controller,native-signing}.ts`、`esign/fadada/fadada-esign.provider.ts`、`owner-signing/{gateway,controller,authorization}.ts`、`owner-h5/{contracts.service,handovers.service}.ts`、`orders/{signatures,signature.service}.ts`、`operations/workflows.ts`及实际后台任务调度入口；新增 `apps/api/test/offline-esign-isolation.test.ts`。先枚举prepare/sign/register/authorize/seal/query/callback及重试调用图，把真实触发点列入实施记录。

**Interfaces：** `assertNewEsignAllowed`覆盖所有发起分支；历史provider/gateway增加明确reconcileOnly入口，query/callback只核验原交易和归档、不新上传/派发签章。保留回调验签、主体/文件/交易绑定与幂等。

- [x] 写 `all_offline_paths_have_zero_fadada_calls`、`legacy_query_callback_cannot_dispatch_seal`：即使旧细分开关开启，用户/API/后台任务/重试均不能发起；历史合法查询可返回既有证据但autoSeal/sign调用为0。
- [x] 写 `old_callback_cannot_approve_offline_archive`、`inflight_esign_is_not_silently_converted`：模式绑定明确，历史证据不丢、未完成任务不被伪造为完成。
- [x] 运行 `node scripts/run-mvp-api-tests.mjs test/offline-esign-isolation.test.ts` 确认失败；再分离原可能自动盖章的query(true)/query默认分支，不以删除回调或吞掉已发生签署解决。
- [x] 重跑同组及 `test/owner-query-isolation.test.ts test/owner-contract-flow.test.ts test/platform-manual-handover.test.ts`、API build；旧发起能力在专门兼容测试配置下验证原规则，在本版部署配置下验证拒绝，记录O12。

### O13：全旅程与安全回归

**Files：** 新增 `apps/api/test/offline-mvp-lifecycle.test.ts`、`docs/evidence/ninda-offline-mvp-validation.md`。复用HTTP测试监听器和外部渠道注入方式。

**Interfaces：** 全程正式HTTP动作，合成数据库及微信渠道替身；不直接UPDATE人员审核、合同归档、付款或交接完成。未配置法大大凭据且拦截所有外网。

- [x] 写完整旅程：人工企业资格/合作文件→确认方案占车→三方合同提交与另一人审核→押金首付→FIELD查验→客户确认→纸质交车单审核→交车→月账单→还车及归还单→结算退款→COMPLETED；断言电子签任务/交易新增数0。
- [x] 写独立失败旅程：缺一方、混文件、自审、模板/条款/manifest变化、退回补件、资料反馈、并发抢车/审核/支付、FIELD离岗、实际收车但未确认、退款未知、线下已签取消、历史回调，覆盖Review Focus五项。
- [x] 使用安全入口单实例运行全量API及第5节三端命令；失败由原任务修复，保存命令/退出码/失败与跳过数，不沿用旧测试计数。
- [x] 主控逐项核对设计覆盖、实际接口和文件权限、原样副本、无生产Mock/秘密值；证据区分单测、合成浏览器、真机和真实支付。未完成项保持未完成，记录O13。

### O14：发布、历史清单与真实验收

**Files：** 修改 `deploy/ninda/README.md`、`.env.example`、`docs/handover-ninda.md`；新增 `docs/operations/ninda-offline-mvp-runbook.md`、`docs/evidence/ninda-offline-mvp-release.md`。

- [x] 准备可审阅发布清单：正式三方合同/费用附件/合作/交还/终止模板及审定证据、人员双人审核、微信商户配置、代码/迁移/页面版本和权限验证；不要求新增法大大注册/章/证书。
- [x] 在宁达独立环境只读盘点当前订单和签署状态；原库为 1 笔待交车、1 份已签合同、1 笔成功付款、0 退款及 1 条已归档车主签署任务。用户另确认不保留历史业务数据，故隔离归档原库、从空业务库开始，不转换历史签署模式或复制授权事实。
- [x] 备份并实际验证隔离恢复，完成 35 项迁移及 API、后台、FIELD、H5 发布；新单 OFFLINE，新电子签总门禁和细分入口关闭。后续至 v7 的 API 补丁均采用 preserve，没有重复空库初始化；后台静态另更新至 `20261028-partner-binding-v1`。
- [x] 完成小程序1.1.5上传及体验版设置：官方上传证据已保存，用户于2026-10-28回复“已切换，检查正常”，确认体验切换及本轮设置、返回位置检查；1.1.4体验确认原文已归档，未独立读取微信后台。
- [ ] 完成本版完整真机业务验收、微信代码审核和正式发布；既有正常登录和1.1.5设置/返回检查不替代完整下单、合同、支付、交还车验收。
- [ ] 按明确主体/车辆/每笔金额/退款范围进行真实支付及真机查验；纸质资料由真实当事人线下签署并由真实不同人员上传/审核，不代签、不伪造证据。未获范围时仅完成合成及只读检查。
- [x] 运行手册覆盖缺页补件、错单/旧版本、归档作废、人员离岗、实际收车待核验、退款未知、历史签署恢复、备份及兼容回滚；服务号沿用已配置的员工工作台入口，本次未改菜单。
- [x] 分别记录服务器和小程序包实际状态：API v7已上线、后台合作商指引版已发布，小程序1.1.5已上传且用户确认体验与本轮界面检查正常；完整真机业务验收、提审及正式发布尚未确认。详见 `docs/evidence/ninda-seven-module-release.md`。专用激活入口在迁移开始后失败时保持维护，不自动回退旧程序；真实业务及渠道验收继续待办。

## 5. 验证命令与完成定义

工作目录 `D:/wechat-miniapp-sub`；以下仅实施命令，本轮文档工作未运行产品测试或数据库迁移。

```powershell
node --test scripts/tests/mvp-test-target.test.mjs
pnpm --filter @chundian/api prisma:generate
node scripts/run-mvp-api-tests.mjs --migrate
node scripts/run-mvp-api-tests.mjs --all
pnpm --filter @chundian/api build
pnpm --filter @chundian/admin test
pnpm --filter @chundian/admin build
pnpm --filter @chundian/admin exec node scripts/qa-offline-admin.mjs
pnpm --filter @chundian/signing-h5 test
pnpm --filter @chundian/signing-h5 build
pnpm --filter @chundian/signing-h5 exec node scripts/qa-offline-owner.mjs
pnpm --filter @independent-platform/miniprogram test
pnpm --filter @independent-platform/miniprogram check
pnpm --filter @independent-platform/miniprogram compile:templates
pnpm --filter @independent-platform/miniprogram build
node apps/miniprogram/scripts/verify-reference.cjs
```

API默认test/*.test.ts；后台src/*.test.ts；H5 src/*.test.ts和src/owner/*.test.ts；小程序tests/*.test.cjs。修改影响到未被默认收录的.spec.ts时显式追加运行，不计作已自动覆盖。旧浏览器脚本可能读开发库，不当纯合成检查直接执行。

开发完成需O01–O13全部有通过证据：无供应商凭据可跑完整OFFLINE流程、电子签新发起数0、角色/文件/版本/资金门禁全部通过。上线完成另需O14实际发布及验收证据。外部提醒仍可选，以站内待办为可靠入口；无已审定业务模板时显示“外部提醒未配置”，不借验证码模板发送。

| 需求 | 任务 |
| --- | --- |
| 新订单线下模式、三方及模板固定、人工企业核验 | O01/O03/O04 |
| 人员/角色/最小数据范围及独立审核 | O02/O05/O11 |
| 上传、版本、齐签核对、补件、归档与反馈 | O04/O05/O09/O10/O11 |
| 合同归档才收款、可信支付及双分支交付就绪 | O06/O13 |
| 查验/客户确认/纸质单/交付分离、实际收车 | O07/O09/O11 |
| 取消终止、退车结算、退款闭环 | O08/O13 |
| 三端易用性、既有FIELD入口 | O09/O10/O11 |
| 历史电子签不丢、新发起为0 | O01/O12/O14 |
| 真机、支付、运行手册及兼容回滚 | O13/O14 |

执行记录初始状态：O01–O14均未开始。每任务独立记录负责人、文件、接口、验证、评审及阻断；本次设计/计划自检不等于功能验收。

## 2026-10-27 实施进度更新

业务实现及本地分层验证已完成，合并任务与替代测试文件见 [七模块开发验收记录](../../evidence/ninda-seven-module-acceptance.md)。API 开发全量 859／859、零失败零跳过，N11／O13 开发验收已完成。随后 O14 已完成独立生产盘点、备份恢复验证、空业务库切换及服务器 v4 发布；五份审定线下模板及两份配套说明已发布，小程序 1.1.2 已上传。发布入口 20／20 验证、最终补丁组合回归 26／26、小程序最新 323／323；上述定向检查不合并冒充重跑 API 全量。真实业务材料、微信发布、真机和限定真实交易仍待完成，见 [生产发布记录](../../evidence/ninda-seven-module-release.md)。未提交或推送。
