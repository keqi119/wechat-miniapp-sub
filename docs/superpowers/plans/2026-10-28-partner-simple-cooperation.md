# 合作商简化办理实施计划

> **For agentic workers:** Use superpowers:subagent-driven-development；主控负责共享schema、迁移、串行数据库测试、集成与发布。用户已明确直接办理，不再请求方案或执行方式确认。

**Goal:** 运营上传协议、填比例、选车辆即可登记；手机号与邀请码确认公司绑定；企业服务只读显示车辆及净实收分润统计。

**Architecture:** 新增明确的简化协议版本/当前车辆关系与邀请绑定事实，保留旧记录而不伪造审批。订单冻结 `revenueRuleSnapshot.mode=SIMPLE_AGREEMENT`；真实成功收退款形成不可变统计事件。后台及H5复用同一查询服务。

**Tech Stack:** NestJS/Prisma/PostgreSQL，React/Vite，已有短信、微信支付及独立portal会话。

**Spec:** [v2.3设计](../specs/2026-10-28-partner-simple-cooperation-design.md)。2026-10-28用户确认：“直接办理，不要求分权复核”。

## 全局约束

- 仅当前项目及宁达独立环境；不清空生产数据、不给真实人员发送邀请、不代本人绑定、不执行真实交易。
- 协议文件、合作商比例、车辆为有效协议必填；比例无默认值，0%合法；其他合作元数据非必填。
- ADMIN/OPERATIONS可直接维护简化合作，无旧19项专项能力、人员映射或双人复核前置。其他业务的原授权边界不随之扩大。
- 金额整数分、比例整数bps、冲突版本、幂等、事务、跨公司隔离和支付回调校验保留。旧签署/业务写接口不重新对H5开放。
- 根目录已部署基线包含大量未提交文件，沿用用户指定checkout并备份，不创建丢失未提交基线的HEAD工作树、不覆盖他人文件、不提交或推送。
- 所有API DB测试由主控用 `node scripts/run-mvp-api-tests.mjs test/<file>.test.ts` 串行执行，仅loopback:55432/chundian_test。子代理不得直接启动DB测试、安装根依赖、迁移或发布。

## 复审重点

1. 空选填字段必须贯穿申请、报价、订单确认、出租方告知；不能在下游重新要求旧审核批次。
2. 旧会话、已重发邀请码和旧短信挑战不能恢复撤销的范围；新绑定不得自动扩展同号所有公司。
3. 分润只统计SUBSCRIPTION，成功收款正数＋成功退款负数，不能双扣；全退精确归零。
4. 协议更新/车辆转绑不回写已成立订单，跨月退款沿原协议比例。
5. 接口只返回本公司车辆与金额；失败/未知来源不能冒充零，已计算不冒充已付款。

## S0：共享模型与接口（主控）

**文件：** `apps/api/prisma/schema.prisma`、新迁移 `202610280004_partner_simple_cooperation`、`apps/api/src/app.ts`、`docs/api-partner-simple.md`。

**接口：**
- `PartnerAgreement`：id/ownerId/revision/status/currentVersionId/createdBy/createdAt/updatedAt；`PartnerAgreementVersion`：id/agreementId/ownerId/version/title/fileIds/vehicleIds/partnerRateBps?/validFrom?/validUntil?/notes/contentHash/createdBy/createdAt。
- `PartnerAgreementVehicle`：vehicleId唯一，ownerId/agreementId/agreementVersionId/revision/assignedBy/assignedAt；与旧OwnerVehicle分离，避免伪造APPROVED。
- `PartnerPortalInvitation`：id/accessId/ownerId/mobileHash/codeHash/status/accessVersion/expiresAt/createdBy/createdAt/boundAt?/previewTokenHash?/previewExpiresAt?；Access新增bindingMethod/boundAt/boundInvitationId，旧review字段不填假数据。
- Payment/Refund新增可空succeededAt；`PartnerRevenueEvent`唯一(sourceType,sourceId)，含paymentId/orderId/ownerId/agreementId/agreementVersionId/vehicleId/modelId/modelName/plateNumber/partnerRateBps/amount/partnerAmount/occurredAt/createdAt。
- 统计快照统一为 `revenueRuleSnapshot`：`mode:'SIMPLE_AGREEMENT',ownerId,agreementId,agreementVersionId,versionId,contentHash,title,partnerRateBps,vehicleId,modelId,modelName,plateNumber,validFrom,validUntil`；`versionId`等于agreementVersionId以兼容方案版本比较。

- [x] 保存当前发布源码与schema基线；记录分工、共享文件及冲突处理。
- [x] 建立模型、仅新增兼容迁移；生成Prisma并在独立测试库迁移，确认旧行保留。
- [x] 定义API DTO/路由契约并注册各模块控制器；不新增Mock或自动业务数据迁移。

## S1：协议登记及下单前置

**文件：** 新`partners/simple-agreements.ts`及`simple-access.ts`；修改`partners/controller.ts`、`partners/revenue-rules.ts`、`vehicles/application-eligibility.ts`、`owner-signing/lessor.ts`、`orders/business-gates.ts`及必要引用。独占这些文件；schema/app注册由主控处理。

**接口：** `readSimpleAgreementSnapshot(tx,vehicleId,range?)` 返回S0快照或null；`SimpleAgreementService`提供主体列表/详情/建立/更新、协议读取/保存/停用/文件授权读取。新协议及快照必须明确模式，历史订单按旧路径解释。

- [x] 先写`test/partner-simple-agreement.test.ts`：仅名称/文件/比例/车辆可以保存；0%与空值区分；选填缺省能通过申请/报价合作门禁；过期/缺文件/冲突车辆拒绝，明确替换事务正确。
- [x] 主控运行确认失败；实现直接登记、版本及车辆归属，不调用旧四领域审核或写假审核人。
- [x] 新版出租方快照版本4：冻结简化协议；未填可选字段用明确未登记展示，不能展示模板占位符或改写固定法律正文。旧哈希不变。
- [x] 增加历史订单、并发转绑、比例变更前后报价、交车不重新按新比例归属的回归；主控运行测试与API构建。

## S2：邀请码绑定及手机号登录

**文件：** 新`partners/company-admin.ts`、`company-admin.controller.ts`；修改`partners/portal-session.ts`、`owner-h5/auth.controller.ts`、`owner-h5/access.ts`、`owner-h5/service.ts`；测试`partner-simple-invitation.test.ts`。独占这些文件，管理员路由总门禁由主控处理。

**接口：** `GET company-admin`；`POST company-admin/invitation {revision,idempotencyKey,mobile,displayName?}`返回DTO和首次`invitationCode`；`POST .../disable`。H5 `POST /owner-h5/auth/invitation/preview {mobile,invitationCode}`→`{previewToken,companyName,ownerId,maskedMobile,expiresAt}`；`POST .../confirm {previewToken,consents}`→原portal Session DTO及安全cookie。

- [x] 先写测试手机号/邀请匹配、7天失效、重发、单次消费、并发、响应丢失重试、改号立即撤权、同号逐公司接受及老短信挑战失效；主控确认RED。
- [x] 随机码安全存哈希，preview短时凭证，确认原子绑定；重复已消费确认提示短信登录，不重复建立授权。默认不发短信。
- [x] 绑定事实支持新INVITATION或既有已复核授权；后续短信登录沿现有challenge/version校验，H5仅新增认证白名单。
- [x] 新管理员角色只读且不依赖Customer；旧电子签及业务写入口仍拒绝。主控测试与API构建。

## S3：成功流水与净实收统计

**文件：** 新`partners/simple-revenue.ts`、`simple-revenue.controller.ts`；修改`billing/billing.ts`、支付gateway/callback所需文件、`billing/reconciliation.ts`；测试`partner-simple-revenue.test.ts`。不得修改S1/S2所有文件。

**接口：** `recordSimpleRevenuePayment(tx,paymentId)` / `recordSimpleRevenueRefund(tx,refundId)`；`readSimpleRevenue(tx,ownerId,query)`→`{totals:{receivedAmount,refundedAmount,netAmount,partnerAmount,platformAmount},groups,items,total,page,pageSize,incompleteCount}`。query为from/to（含首尾日），agreementId/modelId/vehicleId/groupBy（month/agreement/model/vehicle）。Controller同服务用于后台与H5，scope校验分别调用simple-access/portal-session。

- [x] 先写测试：SUBSCRIPTION白名单、不同协议、分次/跨月/全退、支付重复、对账异常、日期边界、未知历史来源不冒充0；主控确认RED。
- [x] 在验签后真实成功事务保存首次成功时间与快照事件；优先有效渠道成功时间，无渠道时间时记录明确的首次确认时间，禁止用updatedAt迁移猜日期。
- [x] 原收款正数、退款负数，按累计退款差值冲回分润分币；BigInt中间运算，金额范围校验。GET不得产生支付、审批或写事件副作用。
- [x] 异常收款不计入正常总额，解除异常仍沿原成功时间且不重复。缺乏可验证旧快照/时间显示incompleteCount，不默认归属/比例。
- [x] 实现协议/车型/车辆/月份聚合及分页，组合筛选安全；主控测试并确认后台/H5一致。

## S4：后台与企业服务界面

**文件：** 后台`partners.tsx`及新`simple-partners.tsx`/`simple-revenue-ui.tsx`、导航/核心权限；H5`owner/Login.tsx`、`App.tsx`、`OfflineWorkspace.tsx`及新`CompanyWorkspace.tsx`，相应模型和测试。后台与H5分别委派，避免同文件重写。

- [x] 真实组件本地合成测试先验证运营无旧能力也能登记；必填仅三项；比例无默认值；查看账号从详情可直接生成/复制邀请码；邀请变化提示旧号撤权。
- [x] 后台详情沿车辆抽屉样式；财务/旧审核流程从日常入口撤下，仅保留历史查看，不出现待复核待办。
- [x] H5首登手机号邀请码→公司确认；后续短信登录，三页概览/车辆/分润，组合筛选/返回位置/错误与零值清楚。只允许认证POST，无修改业务入口。
- [x] 155项现有后台、55项H5基线按新预期更新被替代场景（不得削弱隔离/支付保护），新旧登录兼容；typecheck/build、真实浏览器桌面手机验收。

## S5：整链、复审与发布

- [x] 更新并跑`test/seven-module-journey.test.ts`：运营建档上传协议选择车辆填写比例、生成邀请、企业绑定、租金与退款进入同协议统计、撤权失效，全程合成数据无真实provider。
- [x] 复审模式分支、旧权限路由、文件归属、金额和重试；修复阻断项；API及两前端适当回归与构建。
- [x] 更新API契约、设计状态及操作指引，记录真实未录入协议/比例，不虚构已激活合作。
- [x] 基于当前生产API v22＋静态partner-entry-discovery-v1准备preserve发布，备份验证、迁移兼容及精确候选构建；不带.env/私钥入工件，不改旧系统。
- [x] 发布后校验版本/健康/静态hash、未授权访问和服务号入口，保留可回退证据；仅确认代码已发布，不把未由本人接受的邀请标记已绑定。

## 实际交付与发布

已发布 20261028-partner-simple-v23，具体见 [发布记录](../../evidence/ninda-partner-simple-v23.md)。后台使用 partner-simple.tsx / partner-simple-model.ts / partner-simple.css；H5 使用 owner/SimpleWorkspace.tsx / simple-model.ts，整链复用并更新 seven-module-journey.test.ts。完整验收结果及数据保留证据已归档。
