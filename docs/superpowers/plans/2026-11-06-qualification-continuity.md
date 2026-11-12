# 资格资料更新与本单衔接实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 重复文件不使资格失效，证件更新经审核后可衔接原订单。
**Architecture:** 语义资料快照用于内容一致性；追加订单资格核对记录保留旧签约/风控事实。
**Tech Stack:** NestJS、Prisma/PostgreSQL、React/TypeScript。
**Spec:** docs/superpowers/specs/2026-11-06-qualification-continuity-design.md

## 约束和复核重点
- 基于线上退款修复版冻结源码隔离施工，根目录未发布电子签不得混入。
- 仅新平台；不进行真实付款、退款、签章或代替人工审核。
- 同内容不同ID、不同内容、客户字段变化、证件过期、材料归属错误分别验证。
- 旧资格无可证明的快照、旧版/跨单核对、重复命令、并发资料更新均失败关闭。
- 放行资格不能绕过其他交付条件；历史风险、合同、收款不回写。

## Task 1 资料内容一致性
- [x] 在 apps/api/test/qualification-continuity.test.ts 写相同内容重传、真实变更及历史依据测试，确认红灯。
- [x] 新增 customers/qualification-profile.ts；调整 qualifications.ts、profile.ts、schema 及增量迁移。
- [x] 核验现有客户资料、资格、风险测试（夹具兼容限制见执行记录）。

## Task 2 本单资格衔接
- [x] 为当前有效资格、本单归属和原审核绑定、RBAC、幂等、资料/订单并发变化写失败测试。
- [x] 新增 customers/order-qualification.ts 与专用读/核对端点；在 orders/business-gates.ts 消费核对事实。
- [x] 补全只读原因投影，不改变原合同快照。

## Task 3 后台办理与交付
- [x] 新增紧凑本单核对面板，复用现有证件及资格办理；显示明确失效原因。
- [x] 核验后台真实交互、API事务、相关回归及构建，独立复核。
- [x] 冻结发布，备份和迁移后只读核对目标订单，保留驾驶证待人工审核。
- [x] CAS 合并本次代码回根目录并记录线上验证结果。


执行记录：基于线上 bill-refund-state-v1 的1244文件发布清单隔离完成15文件变更。初始同内容重传和本单接口红灯，之后各回归通过。独立复核发现并修正：旧审核证件冒充当前分类证件、语义一致资料对应新风控的旧原始哈希、规范化后跨分类文件重复；均有红灯反例及绿灯回归。最终资格/风险/有效期29项、浏览器与有效期UI2项通过；隔离PostgreSQL完整77迁移通过，真实Serializable事务并发幂等、回滚、并发资料变更均通过。API在Docker内生成与构建，admin类型及构建通过。

Ruling：根工作树部分旧测试夹具缺少现有资产查验count接口，跨产品/交接用例与线上冻结版本不一致，初次扩展运行57项32通过25失败；不修改产品行为来适配过期夹具。仅在隔离副本为相关资格/风险夹具补齐已有DB接口后运行29项通过，客户资料保存与旧快照兼容由本次真实数据库集成覆盖。借用夹具不放入发布或合并根目录。根目录共享Prisma客户端落后于线上schema，API类型验证以隔离Docker生成客户端的完整构建为准；pnpm自动安装被无TTY拒绝，后续均直接执行已安装工具，未改锁文件。

Ruling：直接实施与新平台发布已有会话授权；严格备份后仅增加nullable快照列和核对表，不自动批准证件，也不回写既有业务记录。根目录3路合并预演15文件无冲突，发布完成后才CAS写入。

发布记录：2026-11-06 完成 `20261106-qualification-continuity-v1` 发布；API 健康，静态清单50文件核对通过，迁移总数77，维护模式已关闭。目标订单发布前后原订单、风控、客户和全部资格记录哈希一致。当前具体原因仅为 `DRIVING_DOCUMENT_CHANGED`，同内容身份证重传不再误报；没有自动审核或核对该订单。15文件 CAS 合并无冲突，根目录新资格回归9/9通过。详细证据见 `docs/superpowers/reports/2026-11-06-qualification-continuity-verification.md`。
