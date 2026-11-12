# 车辆资产资料、内部台账与BAAS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完成真实车辆资产资料、BAAS合同→周期预览→计划→财务确认→人工付款事实的闭环，为折旧和牌照提供共同基础。

**Architecture:** 新增独立领域模型与专用命令；基于已验证的纯计算模块。内部成本不进入客户Bill/Payment。资料与计划由运营维护，成本确认及付款事实由财务执行，菜单权限和后端当前岗位校验一致。

**Tech Stack:** NestJS/Prisma/PostgreSQL、React/Vite。

**Spec:** docs/superpowers/specs/2026-10-31-vehicle-assets-design.md；docs/superpowers/plans/2026-10-31-asset-cost-calculations.md。

## Global Constraints

金额整数分、预览最多120期、批次合计安全整数。日期与账期由asset-costs/calendar验证。当前工作树不批量提交/推送；测试只通过guard独占隔离库。私密资产文件不得进入通用文件、公媒、客户、H5或FIELD下载入口。新关系不能扩大合作商车辆或收益范围。

## 固定数据接口

主控负责Prisma及迁移，模型以设计第3节为基础，新增字段在schema落地后通过消息锁定。BAAS sourceKind='BAAS'、成本category='BAAS_RENT'，折旧为'DEPRECIATION'；costPeriod为YYYY-MM，periodStart/End为包含首末日的Date。

共用命令使用当前staff校验→按排序车辆ID行锁→具体聚合行锁→ArchiveCommand；创建同键用advisory lock且在Serializable冲突后重试整个事务。已成功同键只回放结果，不能先递增业务revision。可变对象revision必须CAS，写入/审计/命令记录同事务。

### A 核心API — admin_scope_audit（后续明确授权开始）

- [ ] 仅写新vehicle-assets目录、asset-costs目录（保留现有calendar）、vehicle-baas目录（保留现有schedule）与相关test。先锁定精确DTO/函数签名，不修改root注册/权限/文件边界/schema。
- [ ] 资产资料GET/PATCH /admin/vehicle-assets/:vehicleId：batteryOwnership UNKNOWN/OWNED/BAAS、firstRegistrationDate可空、notes；未建档返回revision0的明确未登记投影，PATCH创建或更新均带revision/idempotencyKey及vehicleRevision。不修改Vehicle.year/modelYear/VIN/商品。存在ACTIVE BAAS时不允许把类型改为非BAAS。
- [ ] BAAS列表/详情/创建/草稿PATCH及activate/suspend/resume/terminate/archive，路由见设计第8节。计价字段只在DRAFT可改；status不能通用PATCH。只对BAAS资产启用，锁车后检查同车单ACTIVE。启用前真实合同信息、日期、周期、正租金及专用附件齐全。resume不自动恢复作废计划，terminate/archive不生成退款或冲正。
- [ ] GET cost-preview使用previewBaasSchedule，返回候选行、已有计划状态、合计、稳定warningIds、previewHash。hash须绑定算法、合同ID/revision/termsHash、资产revision、精确请求、行及已有计划ID/revision/status；只读不创建锚点或记录。
- [ ] POST cost-plans带合同revision、previewHash、所有warningIds确认及稳定key，重算hash后原子创建SCHEDULED计划，首次冻结firstCostPeriod；相同周期已有记录包括VOIDED均跳过并展示，不改金额。跨合同有效已确认期或仍有效计划重叠拒绝，不能重复计租。
- [ ] AssetCostPlan列表/详情按源和岗位SQL过滤，OPERATIONS只读BAAS计划、不得确认成本。未确认计划void/reopen通过来源岗位检查、revision和重新核对来源；已确认不得重开。
- [ ] POST /admin/asset-costs/confirm `{plans:[{id,revision}],idempotencyKey}`：仅ADMIN/FINANCE、1..120条且无重复ID，锁车/源/计划，校验源、当前计划状态与分金额，整批生成唯一COST分录并标CONFIRMED，任何冲突整批回滚。
- [ ] 成本GET列表/详情和lock/reverse/manual-payment、付款记录void。确认后金额不可PATCH；锁定需原因且不可逆；reverse只新增一次REVERSAL，不改原记录，已锁定或有有效人工付款不能直接冲正。人工付款只适用有效BAAS COST，复制原金额，必填实际paidAt/referenceNo/原因/本资源证据；不是渠道到账、不调用网关。撤销登记保留旧记录，不伪造退款。
- [ ] 首步暂不提供高级correction-preview/confirm路由；错误成本可留痕冲正、按新的真实合同/策略另生成不重复期间的计划。不得宣称复杂已确认期替代已实现。该延后仅删除非原需求必需的高级纠错流程，不影响正常闭环。
- [ ] 暴露供后续折旧服务复用的计划预览hash/原子生成接口，sourceKind/来源FK用明确联合类型；折旧状态及数学由后续模块负责。不得设计任意source JSON创建分录后门。
- [ ] 先红测日期/租金/状态、source归属、失权幂等、跨来源ID、预览变更409、并发重复期/重复确认、付款与冲正约束；schema到位后仅经root授予独占时段跑guard DB。

### B 主控集成

- [ ] schema/兼容迁移、专用资源键与ADMIN/OPERATIONS/FINANCE权限矩阵，文件防旁路、controller/provider注册。边界通过后才接实际新文件上传下载，测试期间可用明确本地合成文件但不得绕过归属校验。
- [ ] 财务asset-costs独立入口，车辆asset/BAAS/折旧/牌照按实现进度进入菜单；后台原有客户账单入口不变。
- [ ] 后台具体UI另分派：元转分、预览表、警示确认、当前版本、提交后只读回读、冲突保留输入并要求重预览；1440/390真实组件测试。
- [ ] 独立审阅、H5/FIELD/客户文件白名单回归、构建及证据；生产部署仍待全部主任务完成及具体上线检查。

## Review Focus

预览不记账；生成不等于财务确认；人工已付不冒充渠道实付；历史已确认金额不回写；牌照/BAAS主档不能让合作商读取客户或成本；同键重放必须先校验当前权限；任何收费/结清不依赖前端总额。
