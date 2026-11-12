# Advertising Copy Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development; after the contract/schema are fixed, API and admin implementations own disjoint files. The primary owns integration, miniapp and root installs. Steps use checkbox tracking.

**Goal:** 产品中心可编辑保存并发布 12 组广告词，小程序刷新读取已发布版本。

**Architecture:** 独立单例草稿 + 不可变发布快照，序列化事务/版本号/幂等回执/审计保护写入；后台独立页复用会话命令恢复，小程序匿名同步并保留经批准文案的离线体验。

**Tech Stack:** 既有 NestJS/Prisma/PostgreSQL、React/TypeScript、原生 JS/WXML/WXSS，不新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-10-advertising-copy-center-design.md`

## Global Constraints

- 仅在本项目写入；原样副本及旧系统/旧业务库保持只读，测试仅使用受保护的本项目本地测试库。
- 固定 12 组与当前 id/顺序；标题 9、首页每行 32、选车小字 40 Unicode 字符，非空单行纯文本。
- 管理员/运营具有独立 advertising-copy.read/write；必须重新核验当前员工、revision、事务幂等与审计。
- 不改单据/费用/客户业务；未知写入保留原体原键，成功回执后只重试 GET。
- 当前 codex 分支含大量连续迭代成果；以目标文件快照为基线增量编辑，不单独提交或覆盖其他人的文件。根依赖/Prisma 生成/锁文件与数据库迁移由主控操作。

## Review Focus

- 草稿与已发布完全隔离，初始化明确标记系统迁移，公开响应不带后台操作者。
- 并发保存/发布与旧 actor 幂等重放都不能越过 revision/当前权限；命令、审计、发布与当前指针同事务。
- 后台在模块切换、403/换账号、成功后 GET 失败及结果未知时保持正确命令状态。
- 小程序迟到旧版本或畸形响应不污染最近有效发布快照，文案失败不伪造车辆成功。
- 运营长文本、粘贴换行、空白输入、未保存修改等明确阻止发布或按约定换行。

### Task 1: 固定契约、数据模型与初始迁移（主控）

**Files:** `apps/api/prisma/schema.prisma`，新迁移 `202611100001_advertising_copy/migration.sql`；`apps/api/src/advertising-copy/defaults.json`；`docs/api-contract.md`。

**Produces:** `AdvertisingCopySet`（id/revision/draftItems/draftHash/updatedBy/updatedAt/publishedVersionId）与 `AdvertisingCopyPublication`（id/version/items/contentHash/publishedBy/publishedAt）；初始 v1 使用当前本地 12 组。

- [x] 保存所有既有目标文件快照；先写 schema/迁移与 seed 一致性的验证，再添加模型和迁移。
- [x] 用本包 Prisma 校验/生成；受保护的测试库应用迁移，核对初始化版本和内容摘要，不连接其他库。
- [x] 将设计 API 契约记录到 `docs/api-contract.md`，冻结供各端实现。

### Task 2: API 服务、控制器与真实 HTTP/DB 测试（API 实现者）

**Owned files:** `apps/api/src/advertising-copy/{types,service,controller}.ts`，`apps/api/test/advertising-copy.test.ts`；默认 JSON 可读不可改。集成 app.ts/auth policy 由主控修改。

**Consumes:** Task 1 模型与 defaults.json，现有 `Db.serial`、`requireCurrentStaff`、`audit/hash`、`ProductCommand`。

**Produces:** `AdvertisingCopyService`（Nest Injectable，Db 注入），`AdvertisingCopyAdminController`、`AdvertisingCopyPublicController`；完整遵循设计的四条接口。额外导出 `advertisingItems` Zod schema 供验证。

- [x] 先写并运行失败测试：初始化公开版本、草稿隔离与发布、RBAC/CSRF/当前权限、非法字段/位置/长度、同键重放/异参、并发保存/发布及事务审计。
- [x] 实现服务和控制器；写事务重新核验当前员工，专用幂等命名空间 `advertising-copy:discovery` / `SAVE_DRAFT` / `PUBLISH`；P2002 重试整个 serial 事务以读取已有命令回执。
- [x] 主控集成后用 `node scripts/run-mvp-api-tests.mjs test/advertising-copy.test.ts` 运行真实 App + DB 测试并核对 API build；不得绕开测试守卫。
- [x] 补充当前员工私有 GET 命令回执，覆盖读写授权/actor 隔离/规范化 hash/明确 absent 与零写入副作用，支撑存储故障下的 GET-only 恢复。

### Task 3: 后台广告词页、预览与命令恢复（后台实现者）

**Owned files:** 新 `apps/admin/src/advertising-copy{,-model,-command}.{tsx,ts,css}` 及相关 `.test.ts`（只创建实际需要的扩展）；不写 App.tsx/modules/navigation.ts，由主控接线。

**Consumes:** 设计 DTO 与接口；现有 `api/ApiError/can/date`、`sessionPendingIntent`、`CommandIdentity`、`ErrorNotice/Loading`。

**Produces:** `AdvertisingCopyPage` 默认或命名导出（报主控）；同文件 UI 实现 12 个槽位、四字段编辑、首页/选车预览、保存、发布核对及状态/历史。`AdvertisingCopyCommand` 使用独立 pending key `advertising-copy`。

- [x] 先写失败测试：未保存禁发布、合法长度/非法控制符、未知命令原体原键、已成功 GET-only、409 保留输入、权限变化撤销及返回模块恢复。
- [x] 实现页面和命令模型，发布确认列出 12 个标题；只显示已保存草稿的待发布内容，编辑输入不被后台回读静默丢弃。
- [x] 命令持久化到 sessionStorage（只存原请求/阶段和会话 SHA-256 摘要，不存凭据），重载恢复未知/GET-only；digest 使用 crypto.subtle，绑定完成后才启用写入；存储失败在新写之前阻断。
- [x] 复核修正：覆盖请求中离开再返回、当前视图获得完成后的最新回读；unknown 恢复先核对 actor 私有回执/原体 hash；权威 absent 才可原命令重放；成功后存储全失败的刷新恢复及实际操作提示准确。
- [x] 运行相关 node 测试与实际 React 页面浏览器测试；主控集成后做 admin typecheck/build。

### Task 4: 小程序远端已发布文案（主控）

**Files:** `apps/miniprogram/src/utils/subscription-copy.js`，新增 `src/services/advertising-copy.js`，`src/services/api.js`，`src/pages/{home,catalog}/index.{js,wxss}`，`tests/subscription-copy.test.cjs` 与新 API/同步测试。

**Consumes:** `GET /public/advertising-copy`；匿名请求和 4s 超时，失败回用最近验证发布快照或随包正式初始文案。

**Produces:** `service.getAdvertisingCopy()` → `{version,contentHash,publishedAt,items}`；`nextSubscriptionCopy(currentId, items?)`。两页只在进入/手动刷新时同步轮换；筛选不额外读取或换字。

- [x] 先运行新增失败测试覆盖匿名/超时/畸形/迟到旧版本、两页新版本轮换、失败保留车辆真实错误、筛选稳定。
- [x] 实现严格响应校验与单调内存缓存，在页面 `load` 返回值里原子写入整组展示，保持并发/会话保护。
- [x] 运行小程序完整测试、检查、模板编译；12 组与长小字进行三宽度排版核验。

### Task 5: 主控接线、全链路核验与独立复核

**Files:** `apps/api/src/{app.ts,auth/role-policy.ts}`，`apps/admin/src/{App.tsx,modules/navigation.ts}`，权限/导航测试；本轮证据 `.runtime/advertising-copy-center-20261110/`。

- [x] 注册两条控制器/服务、加入资源白名单与运营读写；产品中心加入 advertising-copy，接入 `AdvertisingCopyPage`。
- [x] 核验真实后端的保存/发布结果驱动小程序客户端读取（使用隔离库，不触发真实交易）；浏览器验证实际后台页面与布局。
- [x] 完成各包必要测试/build，独立任务复核及最终整体验证；记录失败、修复和未完成的真机/部署项。
- [x] 汇报入口、可操作流程及真实交付状态，不将本地完成写成线上已上线。

### Task 6: 在已授权独立平台交付可用入口（主控）

沿用项目总方案已授权的独立 API/后台部署及体验版验证范围。此模块要让用户在现有后台自行发布，因此准备并核验最小发布包；不提审或正式发布微信生产小程序。

- [x] 只读核验当前线上独立平台，绑定现行发布 `20261110-owner-h5-documents-v1` 的冻结源、镜像、静态与迁移清单；当前 116 个已完成迁移，无维护中状态。只操作 `/opt/ninda-platform` 与 ninda_prod，不访问旧系统。
- [x] 从线上冻结源组装 `20261110-advertising-copy-v1`：只叠加本轮 API/后台/数据模型及新迁移，复用原服务号 H5 产物。修改前 schema/app/role-policy/App/navigation 与线上冻结源逐字相同已核验。
- [x] 独立源码构建并核验新 API 镜像、后台静态，保存摘要/迁移清单与回滚基线；发布脚本仅改 BUILD_VERSION/API_IMAGE，先备份，再加法迁移及切换。
- [x] 独立复核后上线并回读 health/匿名广告词/权限保护/后台资源；不在生产执行合成客户、款项或签章测试，也不代用户发布测试文字。
- [x] 小程序候选以最近实际上传的冻结版本为基线，只移植本轮接入（保留其他聊天尚未发布的视觉提案），完成官方预览/上传；平台体验版切换按真实可操作性记录。

交付核验：API/后台已上线20261110-advertising-copy-v1，公开12组v1、权限保护、真实客户端读取与199线上静态文件摘要通过。小程序1.3.1官方预览及上传已验证，体验版切换未完成，保留此前目标URL安全限制，需用户在微信后台设置。详见 docs/advertising-copy-center-20261110.md 与本轮发布凭据。
