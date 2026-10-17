# 现场交接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 后台派单，专用现场账号采集并直接发布材料，客户在原小程序确认。

**Architecture:** 为现有 AdminUser 添加 FIELD 角色，以独立任务表保存分配、版本和草稿。复用 Handover 的创建/修订/发布服务和原签署完成条件；独立手机入口采用同一管理站点的 Vite 多页面构建。

**Tech Stack:** NestJS、Prisma/PostgreSQL、React/Vite、原生微信小程序。

**Spec:** `docs/superpowers/specs/2026-10-17-field-handover.md`

## Global Constraints

- FIELD 只能访问本人任务和任务附件，改派/取消/停用立即生效。
- 已发布交接不可覆盖；异议另建版本，原独立签署和完成条件保留。
- 10MiB/文件、最多20份 JPEG/PNG/PDF，发布至少一份。
- 不更改原系统，不推送，不伪造真实交付、客户确认、用印或付款。

## Review Focus

- 改派与上传/发布同时发生：事务内再核对归属，旧员工失败。
- 网络丢失发布响应：原幂等编号重试返回同一交接，不能重复通知。
- 后台直接修订交接：工作台识别状态变化，不覆盖或复用旧版事实。
- 附件直链和篡改文件编号：按任务及当前员工授权，无跨任务读取。
- 手机切换账号或任务时慢请求返回：清空旧视图，拒绝旧会话响应。

### Task 1: 任务、权限和发布接口

**Files:** `apps/api/prisma/schema.prisma`、新 migration、`src/field-handover/{rules,service,controller}.ts`、`src/operations/handover-records.ts`、`src/operations/workflows.ts`、`src/auth/{access,auth.controller}.ts`、`src/files/files.ts`、`src/app.ts`、`src/operations/admin.ts`、`test/field-handover.test.ts`。

**Interfaces:** 管理端 `/admin/handover-tasks` 的 list/create/detail/reassign/cancel 和 assignees；员工端 `/admin/field-tasks` 的 list/detail/draft/publish/files；安全会话复用 `/admin/auth/*`，新增本人改密。变更传 `version`；发布传 `idempotencyKey`；附件上传绑定任务版本。

- [x] 写并运行 HTTP 集成测试，先证明 FIELD 无普通后台权限，新任务端点尚不存在；断言跨任务/员工/客户读取失败。
- [x] 实现任务 schema、索引、权限白名单、服务端完整/草稿校验、版本与幂等、任务文件绑定。抽取原 Handover 创建/修订/发布函数，保留原业务条件。
- [x] 执行新测试及原交接/业务完成回归，验证发布和修订接入现有客户响应，状态条件未放宽。

### Task 2: 后台派单与手机工作台

**Files:** `apps/admin/field.html`、`src/field/{main,App,client,forms,styles}.*`、`src/field.test.ts`、`src/{App,resources}.tsx/ts`、`vite.config.ts`；小程序 `pages/handover/index.js`。

**Interfaces:** 使用 Task 1 API，任务状态只从服务端取得；手机独立入口 `/field.html`；后台增加任务资源和 FIELD 账号选项。

- [x] 为时间/表单、状态和会话隔离写失败测试。
- [x] 实现登录改密、任务列表、资料录入、相机/文件上传、保存草稿、发布核对和异议修订，明确读写锁定状态和错误。
- [x] 构建管理端，运行测试；检查移动尺寸、键盘输入、慢响应及中文清单呈现。

### Task 3: 集成核验与部署准备

**Files:** `docs/api-contract.md`、`docs/field-handover.md`、`docs/evidence/field-handover-validation.json`、独立发布包。

- [x] 测试库走完整任务→材料→发布→客户异议→新版本→确认流程；验证无签署不能完成交接。
- [x] 执行代码审查并修正重要问题，记录可复现命令和结果。
- [x] 构建发布包，仅部署独立平台的新增 migration/API/静态资源；核验健康、未认证拒绝、浏览器登录/会话/退出及入口可达。
- [x] 按用户指定开通 `keqi_110` 现场专用账号，验证只具备本人任务权限，凭据仅保存本地；没有创建真实订单或现场事实。
- [ ] 等待用户指定公众号菜单名称和位置后接入。员工本人改密，真实派单及微信相机上传/客户确认由实际人员验收。
