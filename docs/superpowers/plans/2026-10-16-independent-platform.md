# 纯电主义独立平台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 原样保留最新版小程序 Mock，交付独立真实小程序、后台、API、数据库及生产正式发布。

**Architecture:** pnpm monorepo；原生微信小程序、React/Vite 静态后台、NestJS API、Prisma/PostgreSQL。前后台经同一新 API 访问新库，第三方供应商配置独立装配。

**Tech Stack:** Node.js 24、TypeScript、React、Vite、NestJS、Prisma、PostgreSQL 17、Vitest/Node test、Docker Compose、Nginx。

**Spec:** `docs/superpowers/specs/2026-10-16-miniapp-independent-platform-design.md`，用户已确认并授权计划后直接施工，不再增加计划批准步骤。

**执行进展（2026-10-16 14:25）:** Task 1–3 的实现已完成并通过对应本地测试、独立审查和生产只读检查；Task 4 已完成协议实现与微信/SMS 真机登录，真实支付、退款及签署验收待业务资料；Task 5 已部署独立生产服务、批准并发布文案、登记隐私及请求域名、上传开发版 1.0.0，微信审核和正式发布未完成。下方保留原始施工清单，逐项实际证据和剩余事项以 `docs/evidence/release-validation.md` 及进度账本为准。

## Global Constraints

- 当前项目根目录为 `D:\wechat-miniapp-sub`；旧项目及其数据库保持只读。
- 原样小程序源为 `D:\Projects\auto-subscription-platform\.worktrees\wechat-miniprogram-publish-20260924\apps\miniprogram`，提交 `0c78f44bef60211b4738e83f327335af40910340`。
- 法大大来源仓库 `https://github.com/keqi119/subscription-Saas`，固定提交 `453da778dcfefd3727813179382490903644ef26`；本地 Git 对象已存在，用 `git show` 导出，不 checkout 旧工作区。
- 保留 15 页面、4 Tab、既有视觉；演示副本完整，生产包不含演示开关、不回退 Mock。
- 所有金额为整数分。申请审核、最终方案确认、订单、签约、支付、交付的状态不得跳跃。
- 微信手机号主登录、短信备用；真实微信支付和法大大签约；押金+客户主动月付；工单人工派单。
- 生产目标 `139.196.227.195`、`mini-admin.subauto.keybox.cloud`、`mini-api.subauto.keybox.cloud`、`/opt/wechat-miniapp-sub`；独立服务、库、账号、卷。
- 密钥不进入 Git/前端/输出；真实数据由运营录入。法律草稿须用户确认后启用；真实扣款/签署验收需明确对象和金额。
- 共享接口以 `docs/api-contract.md` 为准；变更须通知所有消费者。各实现人员只写自己负责目录，不单独安装根依赖，不修改别人文件，不推送远端。

## Review Focus

- 客户更换记录 ID 或附件 ID：拒绝越权，不返回其他客户信息。归属测试由 Task 2、4 覆盖。
- 同一车辆两个客户确认，或同一客户重复提交：事务保证不重复占用、不重复建单；Task 2 并发测试覆盖。
- 旧版本方案、付款中刷新、签署回调重放：不篡改快照、不重复入账/盖章，Task 2、4 覆盖。
- 空目录、金额 0/null、图片缺失、网络失败：状态可区分，无演示数据回退，Task 1、3 覆盖。
- 月末/跨年账单与整数分、退款超额：日期计划稳定、金额守恒，Task 2、4 覆盖。

## Task 1: 原样副本与小程序真实适配

**Files:** `reference/miniprogram-mock/**`、`apps/miniprogram/**`、`docs/evidence/mock-source-manifest.json`、`docs/evidence/miniapp-verification.md`。

**Interfaces:** 消费 `docs/api-contract.md` 的 `/api/customer/*`、`/api/public/*`；生产 API 配置指向新域名。保留源码服务公开方法和既有展示模型。

- [ ] 用逐文件 SHA-256 固定源工程；排除 node_modules、dist、私有配置及诊断产物并明确排除清单。与源的业务/可迁移配置逐一核验。
- [ ] 运行源工程现有测试作为基线，记录命令和结果。
- [ ] 先补真实 adapter 的请求错误、会话过期、金额 0/null、无 Mock 回退测试，运行观察预期失败。
- [ ] 实现 Bearer 会话、微信手机号登录、短信备用、上传和全部既有服务方法；增加真实签署承载页和支付调用，保持原 15 页视觉结构。
- [ ] 测试支付取消、签署返回后服务端查询、上传失败、旧方案版本冲突以及设置页生产隔离。
- [ ] 原测试与新增测试通过，构建生产包，保存页面对照证据。由主控审阅并提交此目录。

## Task 2: 独立 API 与事务业务

**Files:** `apps/api/package.json`、`apps/api/prisma/**`、`apps/api/src/{auth,catalog,applications,orders,billing,operations,files,common}/**`、`apps/api/test/**`。

**Interfaces:** 实现 `docs/api-contract.md`。Nest 全局 `/api`；客户 Bearer，后台 HttpOnly Cookie + Origin/CSRF 检查。健康 `/api/health` 返回数据库状态与构建版本。

- [ ] 先写金额及账单日计划测试：整数分、月末、12 月到次年；权限测试断言无会话 401、错角色/错归属拒绝。
- [ ] 定义独立 Prisma schema/migration：管理员/会话、客户、车型车辆套餐、文件、申请、方案、订单、合同、账单支付押金退款、交接里程、权益工单通知、审计；金额/状态列结构化，关键业务唯一约束。
- [ ] 新库迁移验证后实现认证、RBAC、审计、文件归属、分页查询、目录和后台运营录入；生产启动拒绝默认密钥及演示身份。
- [ ] 先写重复申请、两客户争同车、revision 冲突测试；实现审核→最终方案→确认建单事务。
- [ ] 实现月账单计划、押金明细、交接事实与签署分离、里程审核、工单受理/派单/取消、通知已读。
- [ ] 提供第三方端口 `IdentityGateway`、`PaymentGateway`、`ESignGateway`；未配置供应商返回明确不可用，不能产生伪成功。Task 4 接真实实现。
- [ ] 在独立测试库跑集成测试，证明客户数据隔离、重复操作和失败事务回滚；提供测试种子和独立生产管理员引导命令，生产不注入演示业务。

## Task 3: 运营管理后台

**Files:** `apps/admin/**`；消费 API 契约，不修改 API 实现。

**Interfaces:** `request<T>(path, options): Promise<T>` 使用 credentials，CSRF 从 `/api/admin/auth/me` 获取；分页 `{items,total,page,pageSize}`；失败展示服务端消息。

- [ ] 搭建 React/Vite/TypeScript、暖白深灰视觉、响应式侧栏与可访问表单；登录、会话过期处理、权限可见性。
- [ ] 实现车辆车型与套餐 CRUD、真实图片/附件上传、上下架及空态。
- [ ] 实现客户资料审核、申请审核/补件、最终方案编辑/发布及版本展示；订单合同详情和签署动作。
- [ ] 实现账单支付押金退款操作、交接与里程审核、工单人工派单、通知、后台账号及审计。
- [ ] 先测客户端价格输入转换和无权限动作不可发起；实现对应处理并验证。浏览器测试错误、空目录和小屏布局。
- [ ] 构建静态包；与真实本地 API 执行“录入车辆套餐→审核→方案→签约/收款→交付”路径，记录仍需外部账号的动作。

## Task 4: 微信、短信、支付与法大大真实接入

**Files:** `apps/api/src/integrations/**`、`apps/api/src/esign/**`、`apps/api/src/contract/**`、相关 tests、`docs/evidence/provider-source-map.md`。

**Interfaces:** 实现 Task 2 定义的三个 Gateway；每个外部请求有超时和明确错误；回调更新业务必须先经过校验。

- [ ] 导出固定仓库版本法大大协议层、provider、签章计划/策略、PDF 与归档层及相应测试，记录源 SHA/路径/改动原因。
- [ ] 适配新 Prisma 实体、存储、审计和客户映射，保留签署计划哈希、企业印章授权及适用批准约束。
- [ ] 先测试验签失败、错合同、重放、迟到回调及失败归档；完成真实回调处理和补偿查询。
- [ ] 接入 `wx.login`/手机号服务端交换和阿里云短信；测试不信任前端 customerId/phone、验证码限流与会话撤销。
- [ ] 接入微信下单/签名/查询/关闭/回调/退款，测试金额守恒、重复回调、超额退款；使用原小程序 AppID 并核验商户绑定。
- [ ] 验证法大大实名/签署入口在小程序的实际承载方式、签署返回状态查询及签后归档，不以静态链接替代验证。
- [ ] 本地和隔离联调环境完成供应商契约验证；真实扣款/签署在指定验收对象获确认后进行。

## Task 5: 文案、部署、端到端验收和正式发布

**Files:** `docs/legal/**`、`deploy/**`、`scripts/**`、`README.md`、`docs/evidence/release-validation.md`。

**Interfaces:** 使用已确认服务器、域名和新库；所有部署脚本显式限定项目目录/Compose 名称和新数据库。

- [ ] 起草合同、方案附件、交接单、用户协议、隐私政策；核对正式主体和联系信息，交用户审定再激活。
- [ ] 配置独立本地 PostgreSQL 容器，验证新库迁移、备份与恢复，不访问旧业务库。
- [ ] 构建镜像/静态包，配置 Nginx 新虚拟主机、DNS A 记录、HTTPS、受限端口、日志与资源上限。
- [ ] 部署前检查容量和旧服务状态；部署新服务，验证域名、证书、版本、健康及备份；记录回滚命令。
- [ ] 用隔离合成客户贯通所有首发业务及权限/回调失败路径；原生开发者工具和真机验证并出报告。
- [ ] 准备小程序正式上传包、隐私配置、域名、类目及审核资料，完成上传、审核反馈处理和正式发布。
- [ ] 全项目构建、类型检查、业务测试通过；做独立整体代码审查，修复重要问题后交付访问地址、版本和运维手册。

## 协作和进度

主控持有根配置、安装锁文件、共享契约、供应商集成及部署；小程序、后台、API 三块可在固定接口下并行，文件归属互不重叠。API 初始模型与 Gateway 约定完成后，再并行适配真实供应商。每块均有实现报告、范围内审查及实际测试证据。

进度账本使用 `.superpowers/sdd/2026-10-16-independent-platform/progress.md`。用户已明确授权计划后直接开工，常规实施不重复请求批准。
