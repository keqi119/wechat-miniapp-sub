# 车型年款主数据 Implementation Plan

实施记录：本阶段已完成本地验证与限定差异复核，未发布。详见 docs/evidence/ninda-admin-rebuild-20261031.md。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 产品的车型范围可选择真实登记的年款，并使车型修改具备版本与幂等保护。

**Architecture:** 在现有ModelDefinition新增可空modelYear及revision，不从Vehicle.year或车型名称猜测年款。沿用现有车型CRUD路由和后台Manager；新增专用命令保护，不重建车辆或产品表。

**Tech Stack:** NestJS、Prisma/PostgreSQL、React/Vite。

**Spec:** docs/superpowers/specs/2026-10-31-admin-rebuild-design.md；docs/superpowers/specs/2026-10-31-rebuild-reference-rules.md。

## Global Constraints

仅当前项目；历史车辆year继续表示上牌年。金额、归属、RBAC不放宽；schema/迁移由主控。模型年款是事实资料，历史空值不回填。当前工作树大量既有修改，先备份限定文件、不提交或推送。

## Tasks

- [ ] 主控增加ModelDefinition.modelYear Int?、revision Int default0，独立兼容迁移，年款限制1900–2100或null。
- [ ] API先写行为红测：创建真实年款、旧null读取、仅改name不重置year、明确清空、同键重放仅一次写入/审计、同键异内容、过期revision、越权、并发冲突。所有新车型写入均需revision/idempotencyKey；不存在隐式绕过。
- [ ] 新增vehicles/model-command.ts，复用当次staff校验、行锁与archiveCommand；创建revision0、修改递增。operations/admin.ts仅加入modelYear DTO、命令字段剥离与专用包装。记录审计可核对年款前后值，不能从车辆year复制。
- [ ] 后台resources车型列表/表单增年款（允许未登记），Manager提交真实revision和稳定key；已有name/bodyType/description维持partial语义。产品选择器已有modelYear标签，验证数据贯通而非添加第二份年款文本。
- [ ] 型号及年款是可经留痕更正的档案信息，修改不回写订单或产品冻结金额。不要扩展成自动创建/发布产品或商品。
- [ ] UI真实流程验证：null→2024、保存回读、过期版本保留输入并刷新提示、车辆2026上牌不显示为2026款。API隔离库通过guard独占安排，根迁移/客户端生成后执行。
- [ ] 专项测试、API/admin类型及构建、独立审阅；更新契约与证据。

## Scope

admin_scope_audit可写operations/admin.ts、新vehicles/model-command.ts、必要车型API测试、admin/App.tsx/resources.ts及新增车型UI测试；主控仅负责schema/迁移/契约。其他代理当前只修products.tsx，无同文件并写。

## Review Focus

空值与省略不同；同名车型年款不猜测；普通车型修改不创建商品；幂等重试后只读当次授权；老订单与原样小程序均不变。
