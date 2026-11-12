# 企业车主三项授权实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将新增授权简化为期间、主体、文件种类，并让完成认证的页面直接展示结果与印章。

**Architecture:** 新增严格v2范围，保留v1记录和校验分支；服务端提供可信主体/类别，H5按版本展示。订单仍逐单冻结文档与身份，v2只取消法人授权中的产品范围限制。

**Tech Stack:** NestJS、Prisma/PostgreSQL、React/TypeScript、Node测试、Playwright合成QA。

**Spec:** `docs/superpowers/specs/2026-10-21-owner-authorization-v2-design.md`

## Global Constraints

- 仅当前项目；旧库不访问；测试只用本地 `_test` 数据库。
- 用户明确本期只有 `SUBSCRIPTION_WITH_FEES`；三个执行开关保持关闭。
- 新说明未经确认不发布，不切换线上v2；禁止代真人授权/签章。
- 密钥不得输出或进入版本库、前端；不提交、推送。
- 并行目录：API人员仅apps/api与.env.example；H5人员仅apps/signing-h5；主控负责文案、文档、集成和最终检查。

## Review Focus

- 旧v1 JSONB摘要或窄范围在新分支被误改：规则回归明确旧摘要及车辆/价格限制。
- 同名/伪造主体与既有无主体快照被放行：执行测试核对当前配置、冻结任务与grant三方。
- 去掉授权车辆清单后可盖其他企业车辆：实际派发重复验证当前归属。
- 只看BOUND便隐藏过期认证：认证完成字段包括本人关系与时间新鲜度。
- 自动图片读取与全局写锁、登出或企业切换发生竞态：合成浏览器检查只读加载、取消及不越界展示。

### Task 1: API范围与执行

Files: owner-signing/rules.ts、authorization.ts、contract.ts、tasks.ts，owner-h5/service.ts，新增范围/服务/执行测试，.env.example。

- [x] 先写v2规则及服务失败用例并确认RED。
- [x] 实现v1/v2联合解析、稳定hash、可信主体与固定类别、版本开关和新版说明门禁。
- [x] 新任务冻结执行主体/类别；v2派发验证归属、模板及三方主体，保留订单/回调/幂等防线。
- [x] 更新detail/options并测试认证完成与无车辆授权条件。
- [x] 运行相关API隔离测试与build，报告原始结果。

### Task 2: H5三项表单与结果展示

Files: owner/model.ts、App.tsx、AuthorityPanel.tsx、AuthorityRecord.tsx、Enterprise.tsx，相关测试与合成QA。

- [x] 测试v2三项payload、伪造选项、v1历史显示、确认清除，确认RED。
- [x] 实现按版本表单/摘要；模板可阅读但不绑定为v2控制项；旧记录保持原范围。
- [x] 测试完成/失效认证及印章直接加载，确认RED后实现；读取图片不持有全局写锁，不执行供应商动作。
- [x] 运行全包单元测试、移动端合成QA、typecheck与双入口build。

### Task 3: 文案、集成及最终发布准备

Files: docs/legal/drafts/ninda/owner-auto-sign-v2.md、output/text/宁达-企业车主自动用印授权说明-v2-待确认-20261021.txt、接口/证据/设计计划。

- [x] 准备完整v2待确认正文；保留已发布v1及其审批记录。
- [x] 集成检查真实执行门禁、接口契约、旧记录无扩权，完成独立代码复审。
- [x] 记录测试证据与上线步骤（发布v2说明后配置scopeVersion2，执行开关仍false）。
- [x] 先以默认v1模式发布经测试的新代码，核验01/02展示生效及原授权条件不变。
- [x] 将可阅读正文交用户确认，获确认后再正式发布并切换新授权页面。

## 本轮执行记录

2026-10-21 20:31 已完成兼容代码上线及18项只读检查。API全套411项、最终受影响44项；H5 32项、合成页面30项通过。最终独立复审无剩余阻断。v2新说明已交用户确认，未发布、未切换新授权模型、未执行真实授权或盖章。

2026-10-21 21:07 用户已确认发布并切换。owner-auto-sign v2已发布、v1原文保留退役；仅新增scopeVersion=2配置。切换前缺文案关闭办理验证及启用后18项线上检查通过，晓浪canRequestAuthority=true；未代本人授权或执行盖章。独立发布复审无剩余阻断，证据见docs/evidence/ninda-owner-scope-v2-enablement.json。
