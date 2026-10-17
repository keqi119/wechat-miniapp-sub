# 企业车主合同签署实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让实际企业车主与订阅客户签署合同，支持车主开启自动授权签署并保留逐份手动确认。

**Architecture:** 新增车主身份、授权范围和按角色记录的合同任务，复用当前法大大应用及摘要/传输实现。原晓浪技术签署通道保留；新通道使用车主企业账号和印章，不替换全局平台配置。

**Tech Stack:** TypeScript、NestJS、Prisma/PostgreSQL、React、微信原生小程序、法大大 API 2.0。

**Spec:** `docs/superpowers/specs/2026-10-17-owner-contract-signing-design.md`

## Global Constraints

- 仅本仓库和独立测试数据库可写；旧项目作为只读参考。
- 默认手动签署；本地开关不能代替法大大真实授权。
- 金额整数分；未知供应商结果不能标记完成或重新换号盖章。
- 平台服务费、清分、车主经营后台留在第二版。
- 正式法律文本需用户审阅；真实认证、授权、付款、签署由本人操作。
- 历史技术验收、晓浪印章和已归档 PDF 不改写。
- 代码复用来源、官方 PDF 和 SDK 证据需可追溯，不记录真实身份响应或密钥。

## Review Focus

- 错企业实名认证结果、同名不同信用代码：不得激活车主身份（任务 1、2）。
- 渠道撤销授权、本地仍开着：执行前重查并阻止自动用印（任务 1、3）。
- 手动领取与自动执行同时发生：最多一个模式持有执行权（任务 3）。
- 换车或模板升级改变出租方/条款：旧授权和旧 PDF 不能静默沿用（任务 4）。
- 企业用印请求超时、用户点重试：查询原交易，不重复盖章（任务 3、5）。

### Task 1: 企业认证与授权的供应商适配

**Files:**
- Create `apps/api/src/owner-signing/fadada-owner.client.ts`
- Create `apps/api/src/owner-signing/provider-evidence.ts`
- Modify `apps/api/src/esign/fadada/fadada.types.ts`（新增实际使用 endpoint 类型）
- Test `apps/api/test/fadada-owner.test.ts`

**Interfaces:**
- 消费 `FadadaConfig`、`FadadaHttpClient`、`buildFadadaRequest`，不改变旧客户端接口。
- 提供 `FadadaOwnerClient.registerEnterprise`、`createVerification`、`queryEnterprise`、`querySeals`、`createAuthorizationUrl`、`queryAuthorization`、`createManualSignUrl`，返回经过严格提取的企业/授权证据，不把原始响应传给前端。
- 所有查询响应必须与调用身份关联；正向成功仅接受文档明确字段。

- [ ] 先写无网络传输测试：企业 account_type=2，认证摘要排除 m_verified_way，认证 status=6 非完成，错 credit_no 拒绝，授权 code=1/status=0 非授权，手动请求绑定企业和指定印章。
- [ ] `pnpm --filter @chundian/api exec tsx --test test/fadada-owner.test.ts`，确认新增测试先失败。
- [ ] 按官方 PDF 实现请求及响应边界；不调用真实注册/实名/授权。
- [ ] 重跑新测试及现有摘要/实名/原生适配测试，记录结果。
- [ ] 检查变更与秘密信息后提交任务成果。

### Task 2: 企业车主建档、认领与实名

**Files:**
- Modify `apps/api/prisma/schema.prisma`
- Create `apps/api/prisma/migrations/202610170021_owner_signing/migration.sql`
- Create `apps/api/src/owner-signing/owner.service.ts`, `controller.ts`, `identity.ts`
- Modify `apps/api/src/auth/access.ts`, `apps/api/src/app.ts`
- Test `apps/api/test/owner-identity.test.ts`

**Interfaces:**
- `OwnerService` 提供草稿建档、邀请认领、读取成员企业、发起实名、主动核验；从服务端会话取得 customerId，不接受调用方自报身份。
- `VehicleOwner` 保存主体；`OwnerMember` 关联已登录客户及经核验经办人权限；`OwnerESignAccount` 独立于个人账号。
- `OwnerSeal` 仅接受当前企业可信查询返回的印章；管理员录入值不能直接激活。

- [ ] 写跨企业读取、邀请重放/过期、手机号错配、认证主体错配、非经办人发起、回跳未核验测试。
- [ ] 测试先失败，再实现模型、迁移及服务；数据库事务负责邀请和身份版本并发。
- [ ] 保留认证信息单独同意与真实启用开关；使用法大大承载证件收集。
- [ ] 独立测试库应用迁移，运行 HTTP 鉴权和身份测试；验证重复迁移及旧实名回归。
- [ ] 提交本任务。

### Task 3: 自动授权开关、范围和执行互斥

**Files:**
- Create `apps/api/src/owner-signing/authorization.ts`, `rules.ts`, `tasks.ts`
- Test `apps/api/test/owner-authorization.test.ts`, `owner-signing-races.test.ts`
- Modify owner-signing migration/schema before deployment as needed.

**Interfaces:**
- `OwnerAutoAuthority` 绑定企业、章、车辆、模板摘要、有效期、金额/期限范围、渠道授权合同及交易证据。
- `evaluateOwnerSigning` 返回 MANUAL_REQUIRED / AUTO_ALLOWED / BLOCKED 和具体原因；不产生外部副作用。
- `OwnerSigningTask`/`OwnerSigningParty` 分别保存任务和 CUSTOMER/OWNER 证据。
- `claimManual` 与 `claimAuto` 对同一任务原子选择；`reconcile` 只查询已有交易并归档。

- [ ] 写范围边界、未授权不能开、运营只能关不能开、过期证书、渠道撤销、部分响应拒绝、关开关与自动发送并发测试。
- [ ] 写手动/自动同时领取、自动已发送不能转手动、未知结果不重签测试。
- [ ] 实现先持久化意图后调用渠道，锁定供应商账号/章/文档；不得在可重试事务里发送外部请求。
- [ ] 复用现有 PDF 字节验证、查询绑定及签后归档；双方证据齐全才完成。
- [ ] 测试通过并提交。

### Task 4: 车辆归属、方案快照及真实出租方合同

**Files:**
- Modify `apps/api/src/applications/applications.ts`, `commercial-terms.ts`
- Modify `apps/api/src/contract/contract-template.ts`, `contract-pdf-render-model.ts`, `contract-pdf-renderer.service.ts`, `contract-pdf-artifact-writer.service.ts`
- Modify `apps/api/src/orders/signatures.ts`, `signature.service.ts`, `signature-preparation.ts`
- Modify `apps/api/src/order-changes/signing.ts`
- Test `apps/api/test/owner-contract.test.ts`, `owner-pdf.test.ts`
- Draft `docs/legal/drafts/owner-signing-README.md` and linked full texts.

**Interfaces:**
- 最终方案携带版本化 `lessorSnapshot`；主合同及补充协议从快照取出租方，不能从可变车辆表临时取。
- 旧资源没有 OWNER 主体时走原通道；新车主合同只走新任务，不将车主 ID 填进 platformProviderId。
- 待签、已签、归档状态以新任务可信证据核对；前端事件不能推进合同。

- [ ] 测试车主未核验/车辆未审核不能生成正式方案，客户不能改出租方，确认后主体变化需新版本。
- [ ] 草拟客户合同、车主认证及自动授权说明和平台协议/隐私增补，交用户审阅；批准前新模板不能发布。
- [ ] 实现正文及 PDF 中 OWNER/CUSTOMER 双方角色；交接文档区分平台作业人员与出租方。
- [ ] 渲染样本并检查所有页及签署坐标，测试旧技术验收 PDF 不变。
- [ ] 回归订单签署、延期、还车和金额控制，提交任务。

### Task 5: 后台与小程序入口、整体联调和生产准备

**Files:**
- Create `apps/admin/src/owner-signing.ts`, `owner-signing-ui.tsx`, `owner-signing-resources.ts`
- Modify `apps/admin/src/App.tsx`, `resources.ts`
- Add native owner workspace under `apps/miniprogram/src` following current generator/page pattern.
- Update `docs/api-contract.md`, `docs/evidence/owner-signing-validation.json`.

**Interfaces:**
- 运营建档/邀请/核验车辆；经办人本人实名、逐份签署、授权范围及开关；客户看到明确出租方及两方进度。
- 所有前端请求使用任务 2/3/4 的路由，不暴露 provider secret 或可跨企业复用的 URL。

- [ ] 先写企业入口显隐、权属错误、关开关、手动覆盖及回跳刷新测试。
- [ ] 实现界面并做浏览器/编译器检查，核对授权不是预勾选，危险状态有准确提示。
- [ ] 全套 API、后台、小程序测试及构建；在独立测试库跑企业认证模拟→两方签约→归档→订单支付/交付/还车流程。
- [ ] 按既有部署流程备份和验证恢复，再部署默认关闭的新功能；不得影响旧技术验收查询。
- [ ] 法律文本获批、真实企业经办人就绪后分步实名/手动签/自动授权验收；需要本人操作时给具体入口，收到可信证据再标记完成。

## 当前状态

- [x] 指定线程、旧 SDK 与官方接口文档只读核对。
- [x] 双模式业务选择已由用户确认。
- [x] 设计与计划自检：旧身份不覆盖、清分不扩展、自动授权不能由开关代替。
- [x] 产品实现和自动化验证。
- [ ] 新法律文本用户批准及真实车主验收。

2026-10-17 发布记录：`docs/evidence/owner-signing-production.json`。九份文案已批准并发布；车主认证入口已开放，真实企业核验、逐份签署和自动授权仍待经办人操作及可信结果。
