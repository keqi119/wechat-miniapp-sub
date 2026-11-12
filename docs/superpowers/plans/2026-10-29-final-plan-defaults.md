# 待审方案默认商业条款 Implementation Plan

> **For agentic workers:** Use test-driven development; backend and admin implementation own separate directories, followed by integration and independent review.

**Goal:** 打开“生成待审方案”后从当前申请关联的已发布产品版本读取结构化报价，自动填入14项通用商业条款，保留人工修订与既有方案，车况使用现场交接证据引用。

**Architecture:** 新增只读 `/admin/applications/:id/final-plan-defaults`，调用产品领域的 `snapshotProduct` 读取关联版本，返回报价、默认条款与来源摘要。后台专用表单加载默认值后再开放提交；既有方案及用户编辑优先。生成候选方案仍使用现有事务、风险审核、幂等与合同快照机制。

**Tech Stack:** NestJS / Prisma / React / TypeScript / Node tests / Playwright。

**Spec:** 本轮用户明确要求；`docs/superpowers/specs/2026-10-27-ninda-seven-module-mvp-design.md`；`docs/legal/versions/ninda/offline-mvp-notices-v2/usage-policy.md`。

## Global Constraints

- 沿用当前项目工作区，其大量未提交内容为连续施工成果；不重置、不提交他人文件、不另行迁移数据库。
- 只读取独立平台数据；不访问旧业务数据库；金额为整数分。
- 用户要求直接施工，沿用已有授权，不新增审批环节。默认值须可检查、可修改；默认文案不能伪造真实车辆、客户、保单或现场事实。
- 产品条款直接读申请关联的已发布产品版本。既有 USAGE_V1 1500公里/150分约束继续由服务端执行，本次不改变产品政策或计费引擎。
- 车况条款明确以现场查验、影像及签字交接单为依据；不预填具体里程、电量或“完好”。
- 不将未确定的保养承担、服务时段、保险保额补成虚假事实；需要本单确认的资料列为提示，缺少真实联系地址保留人工填写。

## Interface

GET result: `{ applicationId, revision, source: { productId, productVersionId, version, name, hash }, values: { monthlyFeeAmount, months, mileagePerMonthKm, excessMileagePriceAmount, energyDescription, benefits: string[], conditions, commercialTerms: Record<string,string>, productSourceHash }, missingFields: string[] }`。

POST final-plan accepts optional `productSourceHash`; when provided verify against fresh product snapshot and reject stale source before writing. Strip it from persistence because the existing productSnapshot already freezes full product provenance. Existing callers remain compatible.

## Review Focus

- API失败、产品未发布/停用：禁止空表单静默提交，可重试。
- 人工条款、已存方案、409回读：不能被异步默认值覆盖。
- 来源在打开后变化：提交时报告冲突，不保存与产品脱节的默认值。
- 修改月费：保持押金计算及调整原因门禁；条款用本单结构化金额引用避免陈旧数字。
- 缺少地址/保单及未发生交接：不虚构事实，现场车况不成为当前报价人工输入门槛。

## Tasks

- [x] API：先写默认值、真实产品来源、缺失资料、来源冲突测试；实现默认条款构建、GET及来源校验；运行定向测试与类型检查。
- [x] Admin：先写优先级/恢复默认/产品字段来源测试；专用方案加载入口、保持已有修改、逐项恢复默认；去除前端固定里程和单价；保留字段编辑及后端政策校验。
- [x] Integration：运行后台完整测试与构建、API相关用例及类型检查；浏览器夹具验证加载、14项默认、编辑保留、恢复、错误重试、提交和窄屏布局。
- [x] Review：独立检查变更与实际测试证据；修复默认文案掩盖缺VIN提示的问题，复审无未解决P1/P2；更新接口文档。
- [x] Release：完成冻结工件构建、保留数据的独立平台发布、线上只读核验并保存证据。

## Execution ledger

- Started: 2026-10-29. Plan derived from explicit user request; API and UI directories assigned separately. No dependency or lockfile changes planned.
- Steering: 用户询问加购里程/换车能力，并要求去掉“权益目录”。已只读确认里程包代码有交易闭环但后台无独立商品管理、当前发布记录仍缺独立购买说明；OFFLINE换车购买仍关闭。本轮移除“权益目录”独立二级入口、保留产品关联和历史数据，旧直链兼容但改用“产品服务配置”表述，不启用新的加购业务。
- Validation: API相关46项、admin完整200项通过；最终缺VIN提醒修复后相关32项及主控定向6项通过。4个本地浏览器场景通过，包括API读取、恢复默认/重读保留、503重试、客服禁入；1440与390宽度布局无横向溢出。admin构建及API/admin类型检查通过。未创建真实业务订单或交易。
- Release: 20261029-final-plan-defaults-v1已冻结445个候选源文件，仅8个修改、4个新增生产文件，无数据库迁移；发布验证结果另见交付证据。
- Delivered: 20261029-final-plan-defaults-v1已上线；123表保留、15份静态hash核验通过。真实申请默认14项字段/产品快照/公开报价只读一致；客户地址待人工补填。线上确认已发布里程包购买说明为0，未开放加购。详见 `docs/evidence/ninda-final-plan-defaults-20261029.md`。
