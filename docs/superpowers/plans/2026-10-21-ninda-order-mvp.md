# 宁达订单履约 MVP 可执行开发文档 / Implementation Plan

> 2026-10-26 更新：本计划已由 [v2.0 线下签约、线上履约开发计划](2026-10-26-ninda-offline-contract-mvp.md) 替代，保留供追溯。停止按本计划新增电子签任务；未完成工作按新 O01–O14 任务重新核对，不把旧任务编号或历史测试数当成新方案已完成。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有宁达独立平台上形成客户小程序、企业车主 H5、平台后台三端订单工作台，完成签约、账单支付、车辆交还与结算退款闭环，并具备可日常管理的人员账号、固定角色和数据权限。

**Architecture:** 复用现有模块化单体、数据库及供应商适配器；新增角色化只读工作区和独立车主—平台托管协议领域。领域动作继续调用已有订单/签署/支付/交接服务，前端展示由同一业务事实派生；首版以逐单手签为标准路径。

**Tech Stack:** Node.js `>=22 <25`、`pnpm@11.7.0`、NestJS/TypeScript、Prisma/PostgreSQL、React/Vite、微信原生小程序、node:test、现有 Playwright 合成浏览器检查。

**Spec:** [2026-10-21-ninda-order-mvp-design.md](../specs/2026-10-21-ninda-order-mvp-design.md)。执行者必须先读该设计基线、`AGENTS.md`、`docs/api-contract.md`、`docs/api-owner-h5.md`。

文档版本：1.1；日期：2026-10-21。全部任务初始未执行；本文不是上线证明。当前用户请求是更新开发文档及设计基线，本轮不开始产品代码施工。后续实施沿用既有项目授权及具体真实操作边界，不因本计划生成而自动打开签署/自动用印开关。

本次新增 T16（人员服务、固定权限及会话安全）与 T17（人员界面及本人账户），共 17 项任务。原 T01–T15 编号保留；下文按依赖把 T16 放在基础阶段、T17 放在后台页面阶段，执行顺序以依赖为准。同步扩展 T01/T06/T08/T11/T14/T15 的契约、待改派投影和验收，不把已有账号 CRUD 当成完整权限管理已交付。

## Global Constraints

- 仅在本项目写入。旧仓库和旧数据库作为只读来源；禁止连接旧业务库做开发测试。
- 金额整数分；客户归属、后台 RBAC、版本冲突、事务幂等、支付/签署回调校验不可省略。
- 小程序原样副本不改写；真实版保持页面视觉，生产不回退 Mock。
- 法大大结构复用来源提交 `453da778dcfefd3727813179382490903644ef26`，不读取落后的旧工作树替代它。
- 密钥禁止输出/入 Git/入前端。真实交易和签章测试需主控确认明确范围。
- 并行人员只写分配目录；依赖声明可编辑本包 package.json，根 pnpm 安装和锁文件由主控统一处理。
- 不单独提交别人文件、不推送、不部署旧系统。重要业务行为先测试，再实现和核验。
- 采用现有 NestJS、Prisma/PostgreSQL、React/Vite、原生小程序；不引入微服务或新消息中间件。
- Node.js 为 `>=22 <25`，包管理器为 `pnpm@11.7.0`；依赖保持项目已锁定版本。
- 时间存储 ISO8601，业务日期与展示使用 Asia/Shanghai；分转元仅用于展示。
- 测试库必须为本项目独立本地 `_test` 数据库；同一测试库同一时刻仅一个 API 测试进程。

## Review Focus

1. 法人会话仍有效但企业关系已变更：旧页面、旧签署请求和旧文件入口立即失效，见 T05/T10/T14。
2. 新模板已发布、旧订单尚未生成 PDF：仍使用已确认精确旧版本；不接受草稿或篡改内容，见 T02/T14。
3. 签署/支付请求已发出但结果未知：保留原任务和交易号，查询恢复，不产生第二次副作用，见 T04/T05/T07/T14。
4. 交接改派、车辆批次变更或客户提出异议：撤销旧权限并创建修订，不能用旧材料完成交付，见 T08/T12/T14。
5. 界面已跳转或用户已读消息：不能当作到账、签署、交接完成；GET 工作区绝不触发用印，见 T06/T09/T13/T14。
6. 人员停用/转岗/重置后旧会话和并发旧密码登录：必须失效；旧通用 PATCH 不得绕过新规则，见 T16/T17/T14。
7. 两个管理员相互停用/降级、申请后换角色自批、FIELD 离岗任务遗留：至少保留一位有效管理员，审批分离与待改派闭环不丢失，见 T16/T08/T12/T14。

## 1. 当前实现与开发策略

| 领域 | 当前可复用文件 | 本版改动 |
| --- | --- | --- |
| 申请与订单 | `apps/api/src/applications/applications.ts`、`apps/api/src/orders/` | 保留确认/占车/快照；新增托管前置校验及三端投影 |
| 企业实名/授权 | `apps/api/src/owner-h5/`、`apps/api/src/owner-signing/authorization.ts` | 已补齐授权办理/启停；本版回归，不重做 |
| 租赁签署 | `apps/api/src/owner-signing/{contract,contract-access,gateway,tasks}.ts` | H5 法人手签适配；精确旧模板继续履约 |
| 平台用章 | `apps/api/src/esign/enterprise-seal/` | 托管协议接入既有审批，不取消双人要求 |
| 资金 | `apps/api/src/billing/billing.ts`、`apps/api/src/usage/returns.ts` | 聚合展示与门禁一致性；保留原写接口 |
| 交接 | `apps/api/src/field-handover/`、`apps/api/src/operations/workflows.ts` | 统一阶段展示和门禁复核，复用 FIELD |
| 客户 UI | `apps/miniprogram/src/pages/`、`src/services/api.js` | 新订单详情、完整待办、当前订单直达 |
| 车主 UI | `apps/signing-h5/src/owner/` | 工作台、车辆、租赁及托管合同全文/签署/归档 |
| 后台 UI | `apps/admin/src/{App,ui,owner-ui,esign-ui}.tsx` | 订单详情、模板审定、资金与交接工作面板 |
| 人员与权限 | `apps/api/src/auth/{access,auth.controller}.ts`、`operations/admin.ts`、`apps/admin/src/resources.ts` | 复用五角色与账号 CRUD，补专用动作、版本/会话竞态保护、角色白名单与人员页面 |

当前项目没有 `packages/contracts` 实体目录，不将其当现成依赖。共享契约先落两份权威 API 文档及合成 JSON 样例，各客户端有明确映射和契约测试，不为了本版另建包体系。

基线须先阅读 `docs/handover-ninda.md` 的最新段落。2026-10-21 19:52 记录的授权功能与文案发布属于已完成项；H5 租赁合同接口、独立托管协议、工作区及历史模板问题仍是本计划重点。开工前刷新差异，若其他线程已完成某项，核验后更新任务记录，不重复覆盖。

2026-10-21 补充：用户已配置服务号 **员工入口 → 车辆交接**，目标 `https://admin.evsub.ndacar.com/field.html`，主控接口回读及公开页面检查通过。此常规入口准备项已完成；T12/T15仍需验证 FIELD 账号、派单和真实交还车流程，不重复创建或改名菜单。证据：[员工入口配置](../../evidence/ninda-field-menu.json)。

人员当前状态：已有 ADMIN/OPERATIONS/FINANCE/SUPPORT/FIELD 单角色枚举、仅 ADMIN 管 users、本人改密接口、敏感变更删除会话及当前管理员自锁保护；FIELD 已有本人改密 UI。尚需本版实现账号 revision/authVersion、最后管理员并发保护、专用人员操作界面、其他后台角色本人改密入口及完整验收。`auth/access.ts` 当前多数非 FIELD 资源读权限宽泛，必须同时收口旧列表/详情/文件，不能只给新工作区裁剪字段。

## 2. 里程碑、依赖与工作分配

| 里程碑 | 任务 | 可验收结果 |
| --- | --- | --- |
| M0 契约、版本和权限基础 | T01–T02、T16 | 接口和合成样例固定，测试库隔离，旧模板可追溯，账号/会话/角色门禁可验证 |
| M1 订单及签约 | T03–T06、T10–T11、T17 | 托管协议、法人手签API、车主及后台工作区接续，人员页面可用 |
| M2 资金与交还车 | T07–T09、T12–T13 | 客户订单中心、双方签约、首付、月账单、交还车、结算退款可操作 |
| M3 集成与受控交付 | T14–T15 | 合成全旅程、真机和明确范围真实验收、运行手册 |

依赖：T01 → T02/T16；T02/T16 → T03；T02 → T05；T03 → T04；T01/T03/T05/T16 → T06；T06 → T07/T08；T06/T07/T08 → T09；T04/T05/T06 → T10；T16 → T17；T02/T04/T06/T17 → T11；T07/T08/T11 → T12；T06/T09/T10/T11 → T13；T01–T13 及 T16/T17 全部完成 → T14 → T15。

前端可以在 T01 的合成契约上先写失败测试及页面，再待依赖合并后联调；不能把合成成功状态带入生产。

T16 涉及鉴权、通用资源和业务关键动作，由主控串行集成；T02/T03/T04/T06 触及相同文件时不得并行改写。T17 与 T11/T12 共用后台 App/resources，后台执行者先完成 T17，再按依赖继续其他页面。迁移名以本计划为预留，执行前检查其他线程已用编号，必要时统一调整并记录映射。

建议采用“接口串行收口、前端按目录并行、主控串行集成”的方式。主控占一个并发槽；最多另外三个执行者。API 同目录有依赖的任务串行，API 测试库由主控独占。

| 工作流 | 可写范围 | 主控专属文件/操作 |
| --- | --- | --- |
| API | 分配的 `apps/api/src/<module>` 与对应 `apps/api/test/*.test.ts` | `schema.prisma`、迁移、`src/app.ts`、`auth/access.ts`、权威 API 契约 |
| 客户端 | `apps/miniprogram/` | 原样参考工程禁止改；根安装/锁文件由主控处理 |
| 车主 H5 | `apps/signing-h5/` | 不改 API、部署或其他端文件 |
| 后台/FIELD | `apps/admin/` | 不改 API、部署或其他端文件 |

每个任务完成后由主控审阅本任务文件、运行针对性检查、记录结果。需要提交时，只提交核实属于本任务的改动；含其他线程改动的文件先做差异归属核对，不使用 `git add .`。本文不要求提交、推送或创建 PR。

## 3. 公共接口约定

T01 在 `apps/api/src/order-workspace/types.ts` 定义以下名字；字段详细定义引用设计基线第 4、7 节。后续任务不得各自改名。

```ts
type WorkspaceActor =
  | { kind: 'CUSTOMER'; customerId: string }
  | { kind: 'OWNER'; customerId: string; ownerId: string }
  | { kind: 'ADMIN'; adminId: string; role: 'ADMIN'|'OPERATIONS'|'FINANCE'|'SUPPORT' };
type PageQuery = { page: number; pageSize: number; keyword?: string; queue?: string };
type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number };
type DocumentAcceptance = { accepted: true; documentHash: string; sourceSha256: string; idempotencyKey: string };
type SignEntry = { taskId: string; status: string; url?: string };
```

`OrderWorkspace`、`WorkItem`、`ManagementTerms` 按设计基线固定字段定义；不向前端发送 Prisma 完整对象。`OrderWorkspace.version` 仅帮助页面识别新快照，写动作使用各对象自己的 revision/version/hash。

`OrderWorkspaceService.get(actor,orderId):Promise<OrderWorkspace>`；`WorkbenchService.list(actor,query):Promise<PageResult<WorkItem>>`。FIELD 不属于 WorkspaceActor，继续专用任务 API。

T01 在 `apps/api/src/auth/staff.types.ts` 单独定义人员契约，不将客户/车主加入后台角色：

```ts
type StaffRole = 'ADMIN' | 'OPERATIONS' | 'FINANCE' | 'SUPPORT' | 'FIELD';
type StaffUserView = {
  id: string; username: string; name: string; role: StaffRole; active: boolean;
  revision: number; createdAt: string; updatedAt: string; pendingFieldTaskCount: number;
};
type StaffMutation = { revision: number; reason: string; idempotencyKey: string };
type StaffQuery = { page: number; pageSize: number; keyword?: string; role?: StaffRole; active?: boolean };
type AdminActor = { adminId: string; sessionId: string; authVersion: number }; // 仅服务端从会话构造
```

`GET /admin/roles` 返回固定 `{code,label,description,dataScope,actions}` 数组。`StaffService` 的 list/detail/create/rename/changeRole/setActive/resetPassword/revokeSessions 对应基线第 7 节，写操作只返回 StaffUserView。`requireCurrentStaff(tx,actor,action)` 在关键写事务内重新鉴权；不得从请求 body 信任 actor/role/authVersion。前端仍用服务端 permissions/capabilities 决定显示，不能自己扩大权限。

H5 路由保持 `/owner/` 下，采用 hash 子路由以兼容现有静态代理：`#/owners/:ownerId/workbench|vehicles|contracts|enterprise`；租赁详情 `#/owners/:ownerId/contracts/:taskId`；托管详情 `#/owners/:ownerId/management-agreements/:agreementId`。固定供应商返回 `/owner/return/`；当前资源 ID 可保存为短期本地导航上下文，但不得保存会话、签署 URL、身份证或渠道凭据。

## 4. 逐项实施任务

### T01：固定契约、样例和测试安全入口

**依赖：** 无。**负责人：** 主控/API。

**Files：** 修改 `docs/api-contract.md`、`docs/api-owner-h5.md`；新增 `apps/api/src/order-workspace/types.ts`、`apps/api/src/auth/staff.types.ts`、`docs/fixtures/mvp-workspace/{customer,owner,operations,finance,support}.json`、`docs/fixtures/mvp-permissions/{roles,staff,field-offboarding}.json`、`scripts/run-mvp-api-tests.mjs`、`scripts/tests/mvp-test-target.test.mjs`、`apps/api/test/mvp-contract.test.ts`。

**Interfaces：** 产出第 3 节类型、设计基线第 3/7 节权限和接口；安全测试入口 `node scripts/run-mvp-api-tests.mjs <test-file...|--all|--migrate>`。样例仅合成人物、车辆和金额，覆盖同一订单的五种视图、五个后台角色及 FIELD 离岗待改派。

- [ ] 先写 `rejects_remote_or_wrong_database`：远程主机、非 55432 端口、非 `chundian_test` 库、缺失变量均拒绝，断言没有子进程启动；`binds_runtime_database_to_test_target` 断言子进程 `DATABASE_URL===TEST_DATABASE_URL`。
- [ ] 执行 `node --test scripts/tests/mvp-test-target.test.mjs`，记录因未实现安全入口而失败；不能依赖连接失败证明保护有效。
- [ ] 实现入口：仅允许 loopback `127.0.0.1/localhost/::1`、55432、`chundian_test`；读取环境后先验证、再设置子进程环境。只接受包内 `.test.ts` 文件、`--all` 或 `--migrate`；不输出连接串。全量串行，显式迁移调用 `tsx src/common/migrate.ts --test`。为本测试库建立单进程占用锁，退出释放；发现活动锁拒绝并行启动。
- [ ] 写 `workspace_contract_redacts_private_fields`：五种样例均包含规定字段；财务/客服无信用字段，车主无其他企业/客户证据；金额全部安全整数；未知 action code 不可执行。先得到断言失败，再补齐类型与样例校验。
- [ ] 写 `staff_contract_has_fixed_roles_and_safe_projection`：人员样例不含密码/哈希/会话凭据，角色固定五种且不含 CUSTOMER/OWNER；角色说明与允许动作一致；锁定人员动作输入、错误码及旧 PATCH 的兼容性收口。
- [ ] 按基线同步权威 API 契约，标注新增接口在对应任务完成前为“规划中”；加入错误码和分页上限，维护接口字段变更记录。
- [ ] 重跑安全入口单测，准备独立测试库后执行 `node scripts/run-mvp-api-tests.mjs test/mvp-contract.test.ts`，退出码 0；主控评审并记录 T01。

### T02：冻结模板继续履约与正式审定动作

**依赖：** T01。**负责人：** API；schema/注册由主控处理。

**Files：** 修改 `apps/api/src/contract/contract-template.ts`、`apps/api/src/contract/contract-pdf-artifact-writer.service.ts`、`apps/api/src/owner-signing/contract.ts`、`apps/api/src/operations/admin.ts`、`apps/api/prisma/schema.prisma`；新增 `apps/api/src/contract/pinned-template.ts`、`apps/api/src/operations/legal-approval.ts`、`apps/api/prisma/migrations/202610210002_mvp_legal_revision/migration.sql`、`apps/api/test/pinned-template.test.ts`、`apps/api/test/legal-approval.test.ts`。

**Interfaces：** `assertPublishedTemplate(document):void` 用于新方案；`assertPinnedTemplate(document,pin):void` 用于已确认交易，pin 含 ID/version/hash/批准及发布证据。`LegalApprovalService.confirm(adminId,documentId,{contentHash,approvalReference,revision})` 记录审定。

- [ ] 写 `retired_pinned_template_remains_usable`、`new_quote_rejects_retired_template`、`changed_body_or_unapproved_pin_is_rejected`：同一旧模板退役后，原订单仍可生成；新报价/草稿/摘要错配返回 409；不得选择最新版替代。
- [ ] 写 `document_edit_clears_approval`、`approval_requires_admin_and_current_hash`：运营代审 403，旧 hash/revision 409，修改草稿后审定字段清空；已发布正文 PATCH 409。
- [ ] 执行 `node scripts/run-mvp-api-tests.mjs test/pinned-template.test.ts test/legal-approval.test.ts`，记录预期业务断言失败。
- [ ] 增量迁移 `LegalDocument.revision/approvalReference`；保留旧确认字段。分别实现新业务模板和冻结模板验证，禁止全局放宽原 `approvedTemplate`；旧订单适配原精确模板引用及原文档批准/发布时间证据，不补造批准快照。更新全部涉及固定模板生成的调用点并保留其他现有模板规则。
- [ ] 执行同组测试及 `test/fadada-template.test.ts test/owner-contract-flow.test.ts`，API build 通过；评审版本切换和历史数据兼容，记录 T02。

### T16：人员服务、固定权限与会话安全

**依赖：** T01；与 T02 共用文件的修改串行。**负责人：** 主控/API。本任务是权限基础，不等到上线末尾补做。

**Files：** 新增 `apps/api/src/auth/{staff.service,staff.controller,staff-session,staff-command,role-policy}.ts`、`apps/api/test/admin-users.test.ts`、`apps/api/test/admin-rbac.test.ts`、`apps/api/test/admin-session-races.test.ts`、`apps/api/prisma/migrations/202610210005_staff_access_revision/migration.sql`；修改 `apps/api/prisma/schema.prisma`、`apps/api/src/auth/{access,auth.controller}.ts`、`apps/api/src/operations/{admin,workflows}.ts`、`apps/api/src/files/files.ts`、`apps/api/src/field-handover/service.ts`、`apps/api/src/billing/billing.ts`、`apps/api/src/esign/enterprise-seal/signature-policy.service.ts`、`apps/api/src/common/config.ts`、`apps/api/src/app.ts`、`.env.example`（仅配置名和说明）；复用 `common/db.ts` 的 Serializable 重试及现有审计、密码哈希能力。实际关键写入若位于被上述文件调用的服务，主控先记录调用点并纳入本任务，不只保护入口函数。

**Interfaces：** 第 3 节 StaffService；`requireCurrentStaff(tx,actor,action)`；`rolePolicy` 是固定角色→资源/动作白名单，兼容已有 permissions 展示，并给新增人员动作明确授权。AdminUser 的 revision/authVersion/updatedAt、AdminSession.authVersion 和 StaffCommand 按基线迁移。人员生命周期沿用 active 布尔值（启用/停用），不新增状态枚举、审批入职、部门或自定义角色模型。

- [ ] 写 `only_admin_manages_staff`、`staff_legacy_patch_cannot_bypass_actions`、`fixed_roles_deny_unknown_actions`：四个非 ADMIN 角色所有人员读写均403；旧敏感 PATCH 返回 STAFF_ACTION_REQUIRED；未知资源/角色/动作默认拒绝；新静态路由不能被通用 `:resource/:id` 吞掉。
- [ ] 写 `staff_revision_and_idempotency_are_enforced`、`staff_response_and_audit_exclude_secrets`：重复用户名409，非法角色/空原因/短密码400；陈旧 revision409；同键重试不重复变更，同键异参409；响应、审计及幂等持久化无密码、密码哈希、会话凭据。摘要密钥缺失返回 STAFF_COMMAND_NOT_READY，既有查询/本人改密仍可用；测试密钥轮换后旧键核验。
- [ ] 写 `admin_cannot_lock_self_out`、`concurrent_admin_disable_or_demote_keeps_one_active`、`revoked_actor_cannot_finish_new_mutation`：两个真实独立管理员请求并发，用同步屏障控制交错，提交后仍至少一个 active ADMIN；事务重试重验操作者，不能只在 guard 读一次。
- [ ] 写 `security_changes_revoke_all_sessions`、`old_password_login_racing_reset_cannot_survive`、`reenable_does_not_restore_old_sessions`：覆盖改角色、启停、重置、本人改密、主动撤销，以及两台设备；登录验证到建会话间插入重置/停用，旧密码请求不能创建仍有效的会话。姓名修改只递增 revision、不撤销会话。
- [ ] 写 `field_offboarding_preserves_evidence_and_requires_reassignment`、`assignment_racing_staff_change_is_rejected`：停用/转岗撤权，不删除任务与材料；未完任务可识别待改派；新指派目标须 active FIELD；改派旧员工附件/发布拒绝。
- [ ] 写 `legacy_routes_share_role_projection`、`role_change_does_not_allow_self_approval`：枚举原列表/详情/文件及动作，财务/客服不能从旧入口取得信用、完整身份、合同源文件或签后 PDF；退款/用章本人发起后换角色或重登仍不得自批；用章另查有效授权。
- [ ] 执行 `node scripts/run-mvp-api-tests.mjs test/admin-users.test.ts test/admin-rbac.test.ts test/admin-session-races.test.ts`，确认新增要求先失败，不能将已有角色/改密测试通过当作任务完成。
- [ ] 实施增量迁移并保留现有账号/角色，两个 authVersion 默认0，存量 updatedAt 以 createdAt 初始化并说明其来源；实现固定策略、人员 DTO 白名单及专用服务，通用 users 写入统一委派或拒绝。删除人员入口不开放；username 创建后不可改，角色必须显式传入，前后端均不默认 ADMIN。
- [ ] 将权限、目标 revision、最后管理员、会话删除、版本递增、脱敏审计与 StaffCommand 保存放在同一事务；使用一致人员行锁顺序及现有可重试事务。登录建会话重验密码版本/active/authVersion；Access 每次比较 authVersion。staff-command 使用 STAFF_COMMAND_DIGEST_KEY 做规范化输入的 HMAC-SHA256，按基线保存唯一键、密钥版本和安全响应；通过现有安全配置方式注入，不输出/入库原始密码，不复用支付/签署密钥。
- [ ] 将 requireCurrentStaff 接入退款/平台用章/派单等关键意图提交事务，阻断已撤权操作者；FIELD 指派与人员变更采用一致锁定策略。已提交或已发供应商的交易保留原核验流程，不能因人员停用删除。待改派从现有未完任务＋当前员工状态派生，不建第二份任务状态表。
- [ ] 执行同组及 `test/auth.test.ts test/api.test.ts test/field-access.test.ts test/field-handover.test.ts test/enterprise-seal-governance.test.ts`，API build 通过；逐项核对基线 §3.2 矩阵及原接口兼容，记录 T16。

### T03：独立托管协议实体、草稿、PDF 与新方案前置条件

**依赖：** T02、T16。**负责人：** API；schema/迁移/注册由主控处理。

**Files：** 新增 `apps/api/src/owner-management/{types,service,pdf,controller,readiness}.ts`、`apps/api/test/owner-management.test.ts`、`apps/api/prisma/migrations/202610210003_owner_management/migration.sql`；修改 `apps/api/prisma/schema.prisma`、`apps/api/src/operations/admin.ts`、`apps/api/src/owner-signing/lessor.ts`、`apps/api/src/applications/applications.ts`、`apps/api/src/app.ts`、`apps/api/src/auth/access.ts`；新增 `docs/legal/drafts/ninda/owner-management-agreement-v1.md`（仅草稿）。

**Interfaces：** `OwnerManagementService.create/adminDetail/update/prepare/review/cancel` 对应基线接口；`requireManagementCoverage(tx,ownerId,vehicleId,startsOn,endsOn)` 返回已归档协议 ID、范围版本和摘要。草稿 terms 严格使用 ManagementTerms。

- [ ] 写 `management_agreement_is_not_customer_order`：创建托管草稿不创建 Application/Order/租金 Bill；双方是 OWNER/PLATFORM；缺必填条款、跨企业车辆、无有效权属均拒绝。
- [ ] 写 `prepared_document_freezes_parties_scope_and_hash`、`cannot_edit_after_provider_attempt`、`only_archived_covered_agreement_allows_new_plan`：PDF 绑定主体/车/模板；范围或期限不符阻断报价和确认；历史已确认订单不回写。
- [ ] 执行 `node scripts/run-mvp-api-tests.mjs test/owner-management.test.ts`，记录未实现行为导致的失败。
- [ ] 按基线建立三表及唯一约束；补充上传/处理中租约字段与幂等请求记录，沿用当前项目事务方式。实现草稿编辑、准备、摘要复核、未发出签署请求时取消及 PDF 授权读取。新增后台资源显式仅 ADMIN/OPERATIONS 可读写，不能落入通用资源默认放行；测试具体路由不被 `:resource/:id` 通用路由截获。拟稿不填虚构费率、结算账户或批准人。
- [ ] 在发布最终方案及客户确认事务内调用 coverage，冻结托管摘要；用 `OWNER_MANAGEMENT_ENABLED` 控制新操作。存量已确认订单保持原快照；未确认旧方案要求重出。
- [ ] 运行同组测试、`test/owner-lessor.test.ts test/order-lifecycle.test.ts` 与 API build；检查无伪造订单/客户及不可逆数据回填，记录 T03。

### T04：托管双方签署、平台审批与归档

**依赖：** T03。**负责人：** API；平台用章和回调注册由主控复核。

**Files：** 新增 `apps/api/src/owner-management/{signing,provider-adapter,owner-controller,callback-controller}.ts`、`apps/api/test/owner-management-signing.test.ts`；修改 `apps/api/src/esign/enterprise-seal/` 中实际接入的审批/计划服务、`apps/api/src/app.ts`、`apps/api/src/auth/access.ts`。

**Interfaces：** `OwnerManagementSigning.ownerSign(customerId,ownerId,agreementId,acceptance):Promise<SignEntry>`、`platformSign(adminId,agreementId,{revision,approvalId,documentHash,idempotencyKey})`、`sync(agreementId)`、`callback(body)`。`sync` 仅核验/归档，不能发起平台用印。

- [ ] 写 `single_party_signature_does_not_activate_management`、`platform_signature_requires_current_approval`：单方签完不是 ARCHIVED；审批人/文件/主体/印章不匹配拒绝；宁达身份缺失不得借用其他企业。
- [ ] 写 `unknown_dispatch_reuses_original_transaction`、`callback_replay_and_wrong_party_do_not_advance`：重复/超时不产生第二交易；错误回调不改状态；双证据齐但签后 PDF 缺失仍不可归档。
- [ ] 执行 `node scripts/run-mvp-api-tests.mjs test/owner-management-signing.test.ts`，确认失败来自未完成的业务能力。
- [ ] 复用现有请求摘要、HTTP、签名查询证据、文件核验和平台用章审批；增加 OWNER/PLATFORM 明确适配，不把平台冒充 CUSTOMER。先持久化发起意图和租约，再调用供应商；未知仅查原交易；平台动作须 OWNER 已签且复核/审批均当前有效。
- [ ] 注册独立可信回调及 H5 法人读/签/同步接口。托管全文通过已鉴权协议详情和文件接口阅读，不把企业逐份条款加入公开 `/owner-h5/legal`。签署失败保留原任务；双方核验证据、签后 PDF 哈希齐备后事务归档。新开关关闭时仍接收旧任务回调和归档。
- [ ] 执行同组测试、`test/enterprise-seal-governance.test.ts` 和 API build；真实签章仅进入 T15 范围验收，记录 T04。

### T05：车主 H5 租赁合同逐单手签 API

**依赖：** T02。**负责人：** API。

**Files：** 新增 `apps/api/src/owner-h5/contracts.controller.ts`、`contracts.service.ts`、`apps/api/test/owner-h5-contracts.test.ts`；修改 `apps/api/src/owner-signing/gateway.ts`、`apps/api/src/app.ts`。复用 `owner-signing/contract-access.ts`、`tasks.ts`、`owner-h5/legal-representative.ts`。

**Interfaces：** `OwnerH5ContractService.list/detail/file/sign/sync` 对应基线接口；`sign` 接收 DocumentAcceptance，服务内选择 MANUAL 并调用 `runOwnerH5`。无单独“已签”写接口。

- [ ] 写 `owner_h5_contracts_require_current_legal_owner`：跨企业404，客户 Bearer/后台 Cookie不能替代法人会话，缺 Origin/CSRF 403，法人停用后详情/文件/签署全部拒绝。
- [ ] 写 `owner_h5_manual_sign_binds_document_and_channel`：错误双摘要409、客户端传印章/供应商账号被严格校验拒绝；客户未签只能预览；返回地址是固定 owner H5；未知结果及重复点击不新增渠道交易。
- [ ] 写 `sync_never_enables_auto_sign`：即使自动开关被测试置真、存在有效授权，调用本 H5 sync 的自动签章调用数仍为 0；假回跳不改签署状态。
- [ ] 执行 `node scripts/run-mvp-api-tests.mjs test/owner-h5-contracts.test.ts`，确认失败；实现列表分页、安全字段投影、逐次法人校验、PDF no-store 与纯同步入口 `gateway.query(taskId,false)`。
- [ ] 执行同组测试及 `test/owner-legal-h5.test.ts test/owner-channel-access.test.ts test/owner-signing-races.test.ts test/owner-contract-flow.test.ts`，API build 通过；回归已完成的授权办理和启停，记录 T05。

### T06：三端订单工作区与待办投影

**依赖：** T01、T03、T05、T16。**负责人：** API。

**Files：** 新增 `apps/api/src/order-workspace/{service,projection,workbench,controller,capabilities}.ts`、`apps/api/test/order-workspace.test.ts`、`workbench.test.ts`；修改 `apps/api/src/orders/customer.ts`、`apps/api/src/app.ts`、`apps/api/src/auth/access.ts`。复用当前领域就绪规则。

**Interfaces：** 第 3 节 `OrderWorkspaceService.get`、`WorkbenchService.list`；新增 owner 车辆列表安全投影。ADMIN/OPERATIONS/FINANCE/SUPPORT 明确允许 workbench，FIELD 拒绝，不能借新增资源名默认放行写操作。

- [ ] 写 `workspace_is_a_projection_without_side_effects`：GET 前后数据库业务记录不变，供应商调用数为0，返回真实主状态及下一责任人；未签、待付款、事实已确认待签等场景动作不同。
- [ ] 写 `workspace_hides_other_customer_owner_and_credit_data`：本人/本企业外404，FIELD403；财务/客服全文 JSON 中不含信用/身份/渠道凭据；车主无其他企业或无关客户资料。
- [ ] 写 `workbench_lists_all_orders_with_stable_priority`：两笔订单、未确认申请、不同到期日均可分页找到；总数与授权过滤一致；不存在权限外总数泄漏；消息已读不删除业务待办。
- [ ] 写 `inactive_field_assignee_creates_operations_todo`：FIELD 停用/转岗后未完任务出现在 ADMIN/OPERATIONS 的交接/异常队列，resourceType=HANDOVER_TASK，主动作 REASSIGN_HANDOVER；FINANCE/SUPPORT 不获得派单动作，离岗员工不再看原任务。人员变更不改交接事实。
- [ ] 执行 `node scripts/run-mvp-api-tests.mjs test/order-workspace.test.ts test/workbench.test.ts`，记录失败；实现白名单投影、可执行动作及 blocker；旧 home/dashboard 适配同一 nextAction 规则，保留兼容字段。
- [ ] 重跑测试及 API build，检查 GET 未调用任何可推进自动用印方法；锁定各端消费样例，记录 T06。

### T07：资金投影与交付/结算门禁一致

**依赖：** T06。**负责人：** API。

**Files：** 新增 `apps/api/src/order-workspace/billing.ts`、`apps/api/test/mvp-financial-gates.test.ts`；必要修改 `apps/api/src/billing/billing.ts`、`apps/api/src/orders/readiness.ts`、`apps/api/src/usage/returns.ts`；扩展 `apps/api/test/business-completion.test.ts`、`payment-recovery.test.ts`。

**Interfaces：** `projectOrderBilling(actor,order):OrderWorkspace['billing']`；所有写入沿用当前 bill/pay/refund/return-settlement 动作，不新增人工改已付接口。

- [ ] 写 `delivery_requires_archive_and_net_paid_first_bills`：主合同未归档、首期缺付、押金部分付、关联退款在途时不可交车；标准零押金不产生虚构应付。覆盖既有 effectiveTermsVersionId 分支。
- [ ] 写 `return_cannot_complete_with_unknown_money`、`money_totals_distinguish_receivable_received_and_refunds`：待核验支付、退款处理中、押金未退、未来已付款未退均阻断结单；退款不被再次算作实收。
- [ ] 执行 `node scripts/run-mvp-api-tests.mjs test/mvp-financial-gates.test.ts test/payment-recovery.test.ts`；先复现规则缺口，再统一工作区与领域动作使用的判断。
- [ ] 保留付款日/起租日快照、退款审批分离、1分验收隔离；逾期仅由到期日与未结清状态派生，不擅自添加违约费。所有计算使用安全整数并检查累计退款上限。
- [ ] 执行同组及 `test/business-completion.test.ts test/order-lifecycle.test.ts`，API build 通过；记录 T07。

### T08：交接阶段、异议修订与任务撤权

**依赖：** T06。**负责人：** API。

**Files：** 新增 `apps/api/src/order-workspace/handovers.ts`、`apps/api/test/mvp-handover-gates.test.ts`；必要修改 `apps/api/src/field-handover/{service,rules}.ts`、`apps/api/src/operations/{workflows,handover-records}.ts`。

**Interfaces：** `projectHandoverProgress(handover,signature,task)` 返回采集、事实确认、签署、归档、运营完成的分别状态；动作继续现有 FIELD 及 customer handover API。

- [ ] 写 `fact_confirmation_is_not_signed_handover`、`objection_requires_new_revision`：事实确认后显示待签、不能直接ACTIVE；异议新修订保留旧清单/证据，旧 hash 确认409。
- [ ] 写 `reassignment_revokes_file_and_publish_access`、`changed_vehicle_generation_rejects_old_materials`：改派/重启后原员工文件访问和发布拒绝，旧材料不可混入新批次。
- [ ] 回归 T16 的停用/转岗与指派竞态，在 delivery/return 两种任务验证历史采集人/文件保留、待改派可接续；运营不能把新任务指派给 inactive 或非 FIELD 人员。
- [ ] 执行 `node scripts/run-mvp-api-tests.mjs test/mvp-handover-gates.test.ts test/field-access.test.ts test/field-handover.test.ts`，新增场景先失败；补齐投影或必要门禁，不重写 FIELD 模块。
- [ ] 重跑同组及 `test/order-lifecycle.test.ts`，API build 通过；核对 delivery/return 两种任务及幂等完成，记录 T08。

### T09：客户小程序订单中心

**依赖：** T06/T07/T08 的接口；可先用 T01 样例。**负责人：** 小程序。

**Files：** 新增 `apps/miniprogram/src/pages/order-detail/index.{js,json,wxml,wxss}`、`apps/miniprogram/tests/order-detail.test.cjs`；修改 `apps/miniprogram/src/app.json`、`src/services/api.js`、`src/pages/home/index.*`、`src/pages/use/index.*`、`src/pages/handover/index.*`；扩展 `tests/customer-api.test.cjs`、`customer-pages.test.cjs`。

**Interfaces：** `getWorkbench(query)`、`getOrderWorkspace(orderId)`；详情 `/pages/order-detail/index?id=:orderId`。原合同、账单、支付和交接页继续接收各自记录 ID。

- [ ] 写 `current_order_link_uses_order_id`、`multiple_orders_remain_selectable`、`next_action_matches_role_and_phase`：不再跳全部列表找当前单；待签、待付款、交接待签、等待车主各有准确入口。
- [ ] 写 `payment_return_waits_for_verified_result`、`session_or_revision_conflict_preserves_context`：客户端 success 不改已付，401重登回本单，409刷新后重新确认，重复点击只发一个在途动作。
- [ ] 运行 `pnpm --filter @independent-platform/miniprogram exec node --test tests/order-detail.test.cjs tests/customer-api.test.cjs`，确认失败；实现页面和 services 适配，保留四Tab、配色与已有组件风格。
- [ ] 运行该包 `test`、`check`、`compile:templates`、`build`；执行 `node apps/miniprogram/scripts/verify-reference.cjs`；检查原样副本哈希一致、生产无 Mock 分支。
- [ ] 用合成数据核验空态、异常、多订单、320/375/430宽度；真实微信支付/签署回跳留在 T15 真机清单，不以 wx stub 替代，记录 T09。

### T10：车主中心导航、合同全文、手签与归档

**依赖：** T04/T05/T06；可先用 T01 样例。**负责人：** 车主 H5。

**Files：** 修改 `apps/signing-h5/src/owner/{App,Enterprise}.tsx`、`model.ts`、`lifecycle.ts`、`style.css`；新增同目录 `Workbench.tsx`、`Vehicles.tsx`、`Contracts.tsx`、`ContractDetail.tsx`、`ManagementAgreement.tsx`、`contracts.test.ts`；新增 `apps/signing-h5/scripts/qa-owner-contracts.mjs`。

**Interfaces：** 第 3 节 hash 路由；租赁合同使用 taskId，托管协议使用 agreementId，不互换。合同全文与归档文件走当前法人鉴权接口。

- [ ] 写 `switching_company_clears_document_acceptance`、`changed_pdf_requires_reread`、`old_response_cannot_replace_current_contract`：切企业/文件/会话清除确认，异步旧响应被丢弃；未确认当前PDF不能发 sign。
- [ ] 写 `return_page_queries_without_success_assertion`、`signing_unknown_resumes_same_task`；浏览器测试覆盖登录失效、无合同、客户未签、归档中和已归档下载。
- [ ] 执行 `pnpm --filter @chundian/signing-h5 exec node --experimental-strip-types --test src/owner/contracts.test.ts`，确认失败；实现四导航和两类合同详情，入驻完成后默认待办。复用现有权限/lifecycle 防竞态机制。
- [ ] 执行该包 `test`、`build`，再执行 `pnpm --filter @chundian/signing-h5 exec node scripts/qa-owner-contracts.mjs` 与 `scripts/qa-owner-authority.mjs`。新脚本使用本地临时静态服务、全请求拦截并拒绝非本地请求，不发送真实短信或签章。
- [ ] 核对手机宽度、全文打开、按钮忙碌态、返回原任务，保留已完成的授权办理/启停能力；不因首版手签移除授权历史，记录 T10。

### T17：人员与权限页面、本人账户与离岗提示

**依赖：** T16；可先在 T01 合成契约上写页面测试，接口完成后联调。**负责人：** 后台，随后继续 T11/T12，避免共同编辑 App/resources。

**Files：** 新增 `apps/admin/src/users-page.tsx`、`users.ts`、`users.test.ts`、`account-settings.tsx`、`account-settings.test.ts`、`apps/admin/scripts/qa-users.mjs`；修改 `apps/admin/src/{App,ui}.tsx`、`resources.ts`、`core.ts`、`core.test.ts`、`field/App.tsx`、`field/client.ts`，复用现有 FIELD 改密 UI。

**Interfaces：** 保留 `#users` 深链，导航归入“设置 → 人员与权限”；人员详情 `#users?record=:id`；当前后台用户菜单提供“本人账户/修改密码/退出”。列表与专用动作调用基线第 7 节，角色说明来自 GET /admin/roles；FIELD 仍走 field.html 和本人改密接口，不能调用全员/roles 管理接口。

- [ ] 写 `staff_page_is_admin_only`、`staff_form_requires_explicit_fixed_role`：四角色不出现人员菜单且深链不加载人员内容；角色未选不提交、不默认 ADMIN；不存在自定义权限选项，登录名创建后只读。
- [ ] 写 `sensitive_staff_actions_are_separate_and_confirmed`、`stale_staff_revision_requires_review`：编辑姓名不夹带密码/角色/active；停用/转岗/重置/退出全部设备分别显示影响和原因；409重新读取且不自动重放；取消不发请求，重复点击只发一次。
- [ ] 写 `staff_secrets_clear_on_finish_or_session_loss`、`self_password_change_returns_to_login`：密码不回填/持久化，完成/取消/401清空；错误旧密码可纠正，成功后清旧详情并回登录；并发旧响应不能恢复已失效页面。
- [ ] 写 `field_offboarding_shows_pending_tasks`：详情列未完任务数及可授权进入的派单入口；人员停用可完成，后续改派由运营处理，不擅自完成/取消任务。本人停用/降级按钮不可用并展示原因，服务端仍独立保护。
- [ ] 执行 `pnpm --filter @chundian/admin exec node --experimental-strip-types --test src/users.test.ts src/account-settings.test.ts`，确认失败后实现专用页面，替换通用 users 编辑表单；本人改密调用现有 auth/password，不要求普通员工获取全员权限。
- [ ] 实现搜索/固定角色/启用状态筛选、空态、失败重试、角色职责、审计入口与更新时间；不造“最近登录时间”。本人退出全部设备成功即清会话；收到401始终清除密码及敏感数据，回登录时只保留受控站内路径。
- [ ] 执行后台 `test`、`build` 与 `pnpm --filter @chundian/admin exec node scripts/qa-users.mjs`；合成脚本全请求拦截并拒绝外网，覆盖五角色、角色调整/停用/重置/撤销、401/403/409及移动宽度。API越权证据引用 T16，不能以隐藏按钮代替，记录 T17。

### T11：后台订单工作台、模板审定和托管操作

**依赖：** T02/T04/T06/T17。**负责人：** 后台。

**Files：** 修改 `apps/admin/src/{App,ui,owner-ui,esign-ui}.tsx`、`resources.ts`；新增 `src/order-workspace.tsx`、`order-workspace.ts`、`order-workspace.test.ts`、`template-review.tsx`、`template-review.test.ts`、`management-agreements.tsx`；新增 `apps/admin/scripts/qa-order-workspace.mjs`。

**Interfaces：** 保留 `#orders?record=:id` 深链，新增 `#workbench`；模板 `#legal-documents`；托管 `#owner-management-agreements?record=:id`。原 `#esign-approvals` 承担平台用章审批。

- [ ] 写 `workspace_deep_link_keeps_order_context`、`finance_and_support_do_not_receive_operation_actions`：深链刷新仍同单，返回列表保留筛选；隐藏之外还覆盖接口403。
- [ ] 写 `legal_approval_and_pdf_review_are_separate_actions`：模板审定、模板发布、逐单PDF复核、平台用章审批四步分别展示，摘要变化使旧确认失效；未获正式审定依据只存草稿。
- [ ] 执行 `pnpm --filter @chundian/admin exec node --experimental-strip-types --test src/order-workspace.test.ts src/template-review.test.ts`，确认失败；实现主导航和订单方案/合同/资金/交接/记录分区，不把现有大组件继续无边界扩张。
- [ ] 接入托管创建/编辑/准备/复核、本人签署进度、平台审批后执行和归档；敏感动作显示对象、版本及具体作用，查询按钮不触发签章。
- [ ] “设置”接续 T17 人员与权限页；订单工作台权限消费 T16 白名单，不能重引入通用资源宽读。运营工作台显式展示 FIELD 离岗待改派入口。
- [ ] 执行该包 `test`、`build`，再执行 `pnpm --filter @chundian/admin exec node scripts/qa-order-workspace.mjs`；新脚本只用合成拦截、本地静态服务，覆盖四后台角色及FIELD拒绝，记录 T11。

### T12：后台资金、交接和退车结算操作面板

**依赖：** T07/T08/T11。**负责人：** 后台；小程序交接表现由 T09 承担。

**Files：** 新增 `apps/admin/src/billing-workspace.tsx`、`billing-workspace.test.ts`、`handover-progress.tsx`；修改 `src/order-workspace.tsx`、`resources.ts`、`field/App.tsx`、`field/forms.ts`、`field.test.ts`；新增 `apps/admin/scripts/qa-mvp-fulfillment.mjs`。

**Interfaces：** 保留 bills/payments/deposits/refunds/return-settlements/handover-tasks 的现有动作；面板消费工作区能力字段及原资源 version。

- [ ] 写 `refund_processing_is_not_refunded`、`readonly_roles_cannot_submit_financial_actions`：分别展示应收/实收/待退/已退；运营无财务提交按钮，直接请求也拒绝；同人申请审批受原规则阻断。
- [ ] 写 `field_only_sees_assigned_collection_steps`、`confirmed_handover_still_requires_signature`：FIELD 不显示财务和最终完成动作，改派后退回任务列表；客户已确认但未签显示独立阶段。
- [ ] 展示未完任务的原经办人及“已停用/角色已调整”状态原因，不向运营返回人员管理原因全文；改派选择仅包含当前 active FIELD，提交冲突后刷新候选与版本，不默认选其他人，历史材料和客户确认仍按原门禁处理。
- [ ] 执行 `pnpm --filter @chundian/admin exec node --experimental-strip-types --test src/billing-workspace.test.ts src/field.test.ts`，确认失败；实现发布账单、可信查询、退款审核、异议修订、还车结算入口及失败恢复。
- [ ] 执行后台 `test`、`build` 和 `pnpm --filter @chundian/admin exec node scripts/qa-mvp-fulfillment.mjs`；合成脚本覆盖“已还车但押金待退不可结单”、未知支付不重发、改派立即撤权，记录 T12。

### T13：可靠待办与可选外部提醒

**依赖：** T06/T09/T10/T11。**负责人：** API，页面改动分别交回原目录负责人。

**Files：** 新增 `apps/api/src/order-workspace/reminders.ts`、`apps/api/test/mvp-reminders.test.ts`；复用现有 `Notification` 和待办 API。若已有可用业务消息渠道，新增 `apps/api/src/notifications/delivery.ts`、`apps/api/prisma/migrations/202610210004_notification_delivery/migration.sql`；主控维护 schema，记录渠道接入情况。

**Interfaces：** `ReminderService.request(actor,event):Promise<{status:'NOT_CONFIGURED'|'QUEUED'|'SENT'|'FAILED';deliveryId?:string}>`；业务事件包含 resourceType/resourceId/revision/recipient/audience，服务端生成去重键。不新增默认发送任务。

- [ ] 写 `read_notification_does_not_complete_work_item`、`missing_external_channel_keeps_in_app_todo`：已读或发送失败不推进业务；未配置渠道返回 NOT_CONFIGURED，无供应商请求；GET 页面不发送提醒。
- [ ] 写 `same_event_does_not_send_duplicate_reminder`、`reminder_does_not_leak_provider_url`：相同对象版本/接收人/渠道去重，通知只含授权站内路径和脱敏内容。
- [ ] 执行 `node scripts/run-mvp-api-tests.mjs test/mvp-reminders.test.ts`，确认失败；先完成站内可靠待办和 NOT_CONFIGURED 行为。
- [ ] 外部提醒接入条件固定为“已有批准业务模板且已有可用渠道适配器”；没有条件时交付 NOT_CONFIGURED 分支并记录，不能借验证码模板发送。具备时 Delivery 记录固定字段 `eventKey,recipientId,audience,channel,status,attempts,lastErrorCode,sentAt`，eventKey唯一，采用本项目数据库任务与幂等方式。
- [ ] 重跑测试及 API build；报告实际接入的渠道与未配置项，不将消息可选项阻断核心站内闭环，记录 T13。

### T14：跨角色全旅程、异常与整体回归

**依赖：** T01–T13、T16、T17。**负责人：** 主控。

**Files：** 新增 `apps/api/test/owner-mvp-lifecycle.test.ts`、`apps/api/test/mvp-regression.test.ts`、`docs/evidence/ninda-order-mvp-validation.md`。复用 `test/order-lifecycle.test.ts` 的 HTTP→数据库旅程、`http-listener.ts` 及现有供应商注入方式。

**Interfaces：** 全程使用正式业务 HTTP 动作；仅初始化合成用户/车辆/正式文案测试样本和注入外部渠道替身，不通过直接 UPDATE 把订单、合同、付款、交接改成完成。

- [ ] 先写端到端失败用例 `owner_mvp_full_journey`：托管双方归档→申请与信用核验→报价确认占车→PDF复核→客户签→法人手签→归档→押金/首期→FIELD交接→客户核对/签署→运营交付→下一期账单→还车→争议处理/结算→退款→COMPLETED。
- [ ] 写 `two_customers_cannot_reserve_same_vehicle`、`retired_template_mid_journey_keeps_original_contract`、`late_payment_callback_and_replay_are_idempotent`、`cancelled_signed_order_requires_termination_and_refund`。断言一车仅一有效占用、原合同 hash不变、仅一笔到账、取消不跳过终止/退款。
- [ ] 写 H5 会话/法人变更、跨企业读取、陈旧报价确认、档案缺证、平台身份错误、通知失败与归档失败恢复场景；供应商替身计数证明自动用印为0。测试外部网络请求必须被拒绝。
- [ ] 增加人员旅程：ADMIN 建 FIELD 账号→员工两设备登录→运营指派→采集草稿→停用/转岗→旧任务/文件/发布拒绝→运营改派→新员工接续→历史证据可追溯；全过程使用业务接口，不直接修改人员状态造结果。
- [ ] 对照基线 §3.2/3.5 跑五角色资源/动作/字段矩阵，覆盖旧通用接口及私密文件；重跑最后管理员、旧密码并发登录、本人改密/重置/撤销、角色变更后自批失败，记录安全版本迁移与回滚兼容结果。
- [ ] 用安全入口单实例运行上述文件；失败由对应任务负责人修复，针对性复测后再做全量。
- [ ] 执行第 5 节命令矩阵，保存命令、退出码、通过/失败/跳过数和产物摘要。既有 `.spec.ts` 不在默认 API test glob 中，按修改影响补充显式执行，不能计作已自动覆盖。
- [ ] 主控独立核对规则覆盖矩阵、文件权限、原样副本、无生产Mock、无明文密钥；证据区分自动化/合成浏览器/真实微信/真实渠道，不以一类代替另一类。

### T15：宁达环境增量发布、受控验收与运行手册

**依赖：** T14；真实操作须满足明确验收范围。**负责人：** 主控，用户/真实签署主体参与本人操作。

**Files：** 修改 `deploy/ninda/README.md`、`.env.example`、`docs/handover-ninda.md`；新增 `docs/operations/ninda-order-mvp-runbook.md`、`docs/evidence/ninda-order-mvp-release.md`。部署脚本只在核对实际需求后改本项目宁达路径。

- [ ] 形成发布清单：具体代码/产物、迁移、开关、模板版本及审定证据、实名与印章、车辆权属、商户与AppID、回调、域名、小程序包。缺项明确责任人和影响动作，不凭历史记录自动认定就绪。
- [ ] 核对实际人员与角色清单、至少一位有效管理员、双人审批独立人员、FIELD 登录/指派及离岗改派责任人；不批量生成默认密码或共享账号。发布 API/后台前完成 authVersion/StaffCommand 兼容迁移，安全配置人员请求摘要密钥并记录版本及轮换保留规则，原 users 敏感 PATCH 与新界面同批收口。
- [ ] 先完成可审阅的合成演练和明确真实验收单，列出企业、本人操作人、车辆、申请人、每笔支付/退款金额、文档摘要、次数和停止条件。没有该范围不做真实支付/退款/签署；不得代本人收码、刷脸或授权。
- [ ] 依现有宁达发布手册备份数据库/文件及配置摘要，验证备份恢复路径；增量部署 API 和页面，新增开关先关闭。核对健康、匿名拒绝、跨端隔离、回调验签及产物版本后再开放指定范围。
- [ ] 真机验收客户微信登录/实名/签署/付款/交接，法人服务号登录/全文/手签/归档，后台审核与FIELD；真实结果分别查询验证。首版 `OWNER_AUTO_SIGNING_ENABLED=false`，不借“查询”触发自动盖章。
- [ ] H5 合同链路及本人登录验收完成后，才按既有渠道策略切换小程序车主入口；保留明确引导。小程序须单独核对上传、体验、提审、审核及正式发布状态，不与服务器部署混同。
- [ ] 回滚演练：关闭新入口/新发起，恢复上一前端/API兼容版本；保留新增表、在途查询/回调/归档及资金补偿，不回滚删除已发生业务事实。异常交易由运行手册按原交易核验。
- [ ] 权限回滚单独核验：ORDER_MVP_WORKSPACE_ENABLED 关闭不影响人员撤权、字段裁剪和会话版本校验；拒绝直接回滚到忽略 authVersion/重新开放敏感 PATCH 的版本。必要时暂停人员敏感写入并向前修复，保留改密/退出/审计及已撤销会话失效。
- [ ] 交付运行手册：日常待办、模板换版、错误恢复、合同归档失败、支付未知、退款异常、交接异议、交付延期、备份恢复及权限管理。最终写明实际发布范围、未完成平台审核/真实验收项。

## 5. 验证命令矩阵

以下命令供实施时执行；本次文档编写没有运行产品测试、数据库迁移或渠道调用。工作目录统一 `D:/wechat-miniapp-sub`。T01 安全入口未实现前，不运行依赖它的命令。

```powershell
node --version
pnpm --version
node --test scripts/tests/mvp-test-target.test.mjs
pnpm --filter @chundian/api prisma:generate
node scripts/run-mvp-api-tests.mjs --migrate
node scripts/run-mvp-api-tests.mjs --all
pnpm --filter @chundian/api build
pnpm --filter @chundian/admin test
pnpm --filter @chundian/admin build
pnpm --filter @chundian/signing-h5 test
pnpm --filter @chundian/signing-h5 build
pnpm --filter @independent-platform/miniprogram test
pnpm --filter @independent-platform/miniprogram check
pnpm --filter @independent-platform/miniprogram compile:templates
pnpm --filter @independent-platform/miniprogram build
node apps/miniprogram/scripts/verify-reference.cjs
pnpm --filter @chundian/signing-h5 exec node scripts/qa-owner-authority.mjs
pnpm --filter @chundian/signing-h5 exec node scripts/qa-owner-contracts.mjs
pnpm --filter @chundian/admin exec node scripts/qa-order-workspace.mjs
pnpm --filter @chundian/admin exec node scripts/qa-mvp-fulfillment.mjs
pnpm --filter @chundian/admin exec node scripts/qa-users.mjs
```

通过标准：退出码0；相关用例无失败、无未解释跳过；构建和小程序模板编译成功；浏览器无未处理异常/外部真实请求；原样副本哈希一致。既有 admin `qa.mjs/qa-governance.mjs` 会读取根环境并依赖开发库，不可当纯离线检查直接运行。

API默认收录 `test/*.test.ts`；后台默认 `src/*.test.ts`；H5默认 `src/*.test.ts src/owner/*.test.ts`；小程序默认 `tests/*.test.cjs`。新测试按以上位置落盘，不能写在未被执行的目录后声称通过。新增根脚本单测显式运行。

## 6. 需求—任务—验收追踪

| 需求 | 实现任务 | 验收证据 |
| --- | --- | --- |
| 一单一车、方案版本、客户归属 | T03/T06/T14 | 并发占车、旧方案拒绝、客户越权 |
| 三端订单进度与下一步 | T06/T09/T10/T11 | 同一订单五种样例、角色页面、无副作用GET |
| 独立托管协议 | T03/T04/T10/T11 | 双方签署证据、独立实体、PDF归档、范围门禁 |
| 法人手签完整接续 | T05/T10 | H5登录→全文→签署→回跳查询→归档 |
| 历史模板与正式审定 | T02/T11 | 退役模板原单继续、新单拒绝、编辑清除审定 |
| 账单、支付、退款、押金 | T07/T09/T12 | 可信到账、未知恢复、退款核清、金额分离 |
| 现场任务、事实、独立签署 | T08/T09/T12 | 改派撤权、异议修订、三阶段不混同 |
| 取消、还车与结算 | T07/T08/T12/T14 | 终止规则、未来账单处理、退押后结单 |
| 认证/授权既有能力保持 | T05/T10/T14 | owner-authorization-entry、owner-legal-h5等回归 |
| 原视觉与原样副本 | T09/T10/T11/T14 | 截图、真实模板编译、109文件基线按现有工具核验 |
| 提醒失败可继续业务 | T13/T14 | 站内待办保留、去重、无敏感链接 |
| 固定角色、数据/文件最小范围 | T01/T16/T06/T17/T14 | 五角色白名单、旧入口越权、字段裁剪、直接HTTP拒绝 |
| 人员创建、启停、角色与会话生命周期 | T16/T17/T14 | 版本/幂等、最后管理员、旧密码竞态、多设备撤销、审计无密码 |
| FIELD 服务号入口与离岗交接 | T16/T17/T06/T08/T12/T15 | 已配菜单证据、本人任务、停用转岗待改派、历史材料保留 |
| 管理员仍受审批分离约束 | T16/T04/T07/T14 | 退款/用章自批拒绝、换角色不绕过、独立用章授权 |
| 发布与可恢复运营 | T15 | 实际版本、明确真实范围、真机证据、回滚/运行手册 |

## 7. 执行记录与完成定义

每任务记录：负责人、开始/结束时间、文件清单、接口变化、测试命令/结果、评审结论、剩余阻断。任务步骤勾选仅依据对应证据，不沿用历史测试数。

| 任务 | 初始状态 | 结果/证据 |
| --- | --- | --- |
| T01–T13 | 未开始 | 保留原业务任务，本次补齐权限依赖与验收 |
| T16 | 未开始 | v1.1 新增人员服务、固定权限、会话与并发保护 |
| T17 | 未开始 | v1.1 新增人员页面及本人账户 |
| T14–T15 | 未开始 | 集成、发布及真实验收须包含新增人员任务 |

开发完成：T01–T14 及 T16/T17 全部通过且无核心流程或人员权限缺口；站内可靠待办已具备，外部提醒未配置时如实标记。上线完成：T15对应实际发布/验收证据齐备。微信审核、真实签署、真实退款尚未完成时继续列未完成，不能用“接口已接通”代替。

文档编制核验：主控对当前源码路径、包测试脚本、最新交付记录、三端权限及API基线做了只读核对；v1.1 追加核对 auth/access、账号通用写入、登录/本人改密、Prisma 人员模型、后台资源表及 FIELD 派单。并行只读审阅提供差异和场景，最终接口、任务依赖及自检由主控统一。本文不覆盖其他线程工作，也不自动授予生产交易或用印权限；本轮没有运行产品测试或数据库操作。
