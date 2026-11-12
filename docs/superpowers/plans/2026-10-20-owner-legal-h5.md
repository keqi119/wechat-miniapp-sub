# 企业法人 H5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 服务号进入独立法人 H5，安全接续已有企业认证并提供印章和用印授权管理。

**Architecture:** 新增 owner-h5 API、独立会话和法人档案，复用现有企业认证/印章/授权服务。H5 独立页面与 nginx 路径；已有客户签约入口维持独立。

**Tech Stack:** NestJS、Prisma/PostgreSQL、React/Vite、Nginx、法大大 API 2.0。

**Spec:** `docs/superpowers/specs/2026-10-20-owner-legal-h5.md`

## Global Constraints

- 仅写当前项目；测试仅用独立 `_test` 数据库。
- 密钥不输出/入库/入 Git/入前端；金额整数分；实名与签署真操作由本人完成。
- 法人手机号登录不等于法人核验；法大大证据必须匹配类型、姓名、手机号、企业及认证流水。
- 所有写入受会话、来源、CSRF、企业关系和并发校验约束。
- 保留已认证企业账号；不自动重新注册/创建未知结果请求，不自动选章或启用授权。

## Review Focus

- SMS 校验与邀请领取之间邀请撤销或法人资料变化：事务内重查。
- 法人切换与旧成员并发操作：租约及条件更新，不短暂授予旧身份权限。
- H5 回跳被伪造或返回旧小程序地址：固定返回路径，主动查询才更新。
- 会话可用但企业关系已停用：每次敏感请求重新检查。
- 未具备短信或授权配置：页面说明准确，生产门禁保持关闭。

### Task 1: 法人登录与会话

**Files:** 新建 `apps/api/src/owner-h5/{config,access,auth.controller,legal-representative}.ts`、`apps/api/test/owner-h5-auth.test.ts`；修改 Prisma schema 和新增迁移。

**Interfaces:** `/api/owner-h5/config`、`legal`、`auth/sms/request`、`auth/login`、`auth/me`、`auth/logout`；请求与响应详见 `docs/api-owner-h5.md`。导出 `requireOwnerLegalRepresentative(db,customerId,ownerId)` 供业务层复核。

- [x] 先测试邀请+手机号+验证码、首次注册原子性、旧凭据拒绝、Origin/CSRF、停用/过期。
- [x] 实现独立会话、运营法人档案和受邀首次登录；所有生产配置缺失均关闭入口。
- [x] 执行专属测试及 API 构建。

### Task 2: 法人业务与认证接续

**Files:** `owner-signing/identity.ts`、`fadada-owner.client.ts`、新增 `owner-h5/owners.controller.ts`、`owner-h5/service.ts`、测试；主控处理 app/access 注册。

**Interfaces:** 见 API 合同；复用现有 selectSeal、OwnerAuthorizationService，新增 `startLegal`/`refreshLegal` 或等效明确渠道入口。

- [x] 测试法人类型/姓名/号码不匹配、已有账号接续、并发改变、旧成员停用和旧渠道拒绝。
- [x] 核对法大大 H5 文档并测试请求参数、固定返回地址。
- [x] 实现身份接续与逐操作 capabilities，保持独立授权门禁。
- [x] 执行业务及既有企业认证回归。

### Task 3: H5 界面与小程序迁出

**Files:** `apps/signing-h5/owner.html`、`src/owner/**`、Vite 配置及测试；主控另处理小程序入口与测试。

- [x] 测试 URL 精确允许列表、无自动实名/授权、表单与权限及返回查询。
- [x] 实现登录、企业选择、认证、印章、授权范围和状态；不添加代理人字段。
- [x] 构建并检查移动端布局，生产切换前保留原入口正常行为。

### Task 4: 集成和上线

**Files:** API wiring、`deploy/ninda/**`、`.env.example`、运营文档、证据。

- [x] 测试完整 HTTP 访问隔离与旧渠道门禁；API/H5/小程序构建。
- [x] 配置短信前置条件门禁、法人档案来源、独立代理与发布备份；保留关闭状态直至条件齐全。
- [x] 备份新数据库、迁移、发布并核对健康和匿名/鉴权边界；读取服务号菜单后保留其他项。
- [x] 补齐可用短信凭据、签名和验证码模板，核验审核状态后启用法人 H5 登录；15 项线上检查通过。
- [ ] 法人本人收码登录验收后，更新服务号菜单及小程序迁移提示，完成旧入口切换。
- [ ] 由真实法人验收登录、扫脸/主动回查、选章；不代本人执行。

## Execution ledger

2026-10-20：用户已授权生成计划后直接施工，按并行目录分工实施，不再重复请求整体批准。当前工作区含此次迁移的未提交变更，继续在本项目施工，不提交其他人的文件。生产短信服务四项配置缺失，已请求凭据路径和审核签名/模板；实现和合成验证继续。

工程实现已完成首轮验证：API 全套 377/377、小程序 265/265、H5 24/24；独立复审提出的持久渠道校验、未经法人核验的撤销权限已修复，相关回归 57/57。首次 H5 切换与旧请求并发覆盖已补充三个受控交错测试（先复现失败，再修复通过），最终相关回归 51/51，独立复审通过。发布使用最终修复后重新构建的镜像。

短信只读查询已使用用户既有 RAM 文件尝试，签名和模板 API 均返回 `NoPermission`。生产仍缺可用短信凭据、已审核签名及验证码模板。已准备保持新入口及全局迁移开关关闭的发布候选，不把页面部署等同于法人登录或实际用印可用。

19:14：`20261020-owner-h5-v1` 已激活，26项数据库迁移全部完成，两法人档案登记完成，13项线上检查通过，旧企业业务绑定与计数未变。候选双开关保持 false，服务号菜单保留。上线控制脚本的结束标记被嵌套 Compose 命令消费标准输入；未重复激活，通过独立只读回查核验当前镜像、配置摘要、符号链接与健康版本后确认成功，并修正控制脚本 stdin 隔离。线上浏览器连接两次超时；HTTP和静态字节核验通过，本地移动端 CUA 验收通过，未声称已做微信真机验收。
