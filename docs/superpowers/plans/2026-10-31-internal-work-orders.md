# 内部事故维修与保养实施计划

承接`2026-10-31-residual-maintenance-design.md`。本计划已在授权范围内形成，待残值接口包交接后按目录分派；此时尚未新增工单模型、接口或开放入口。

## 分包与真实来源

1. 主控追加六个模型：AssetWorkOrder、AssetWorkOrderEvent、VehicleOperationalRestriction、VehicleMaintenanceSchedule、AssetWorkOrderCost、AssetRecoveryRecord。工单/限制/费用来源的vehicleId用真实FK；费用行与工单通过复合FK保证同车。ServiceRequest仅可选来源，保留独立状态和客户归属。不得读取旧库或批量猜测迁移客户事故记录。
2. 运营包独占新`asset-work-orders/`与`vehicle-maintenance/`、对应测试。严格事实DTO、当前角色、版本、幂等和追加事件；事件序号由锁内递增，不把附件上传导致的revision间隙当成缺事件。事故理赔结论与到账事实分离。保养验收才更新下次提醒，客户已核里程和权益不被覆盖。
3. 主控将同一restriction helper接车辆目录、新方案最终占车、换车目标和实际交付。业务写入必须在已有Vehicle锁后重查；仅隐藏目录不算完成。安全还车不受该限制阻断；工单关闭不暗自解除车辆限制。
4. 财务包独占新工单费用服务。费用来源DRAFT上传自身财务凭据；已验收且待成本确认的工单才可预览/冻结。每一笔明确费用来源生成唯一计划，WORK_ORDER不能与BAAS/折旧共用车/月互斥。
5. 主控扩共用asset-costs来源联合类型、显式分支、sourceLock和真实FK。未知来源必须拒绝，不能落入现有DEPRECIATION的else分支。BAAS期间互斥、折旧累计预算、原COST唯一性及冲正/付款约束保持；WORK_ORDER以同来源唯一、真实验收证据和替代链校验。
6. 文件域再扩WORK_ORDER、WORK_ORDER_COST两个父FK，八种parent恰一。运营工单凭据和财务费用凭据权限分离，费用冻结后不改原凭据或挪映射。各旧fixture仅补真实nullable列，不减少断言。

## 状态及关单

运营：PENDING→IN_PROGRESS↔WAITING_EXTERNAL→PENDING_ACCEPTANCE；验收后有成本进入PENDING_COST_CONFIRMATION，否则须明确无成本原因才CLOSED。退回处理保留原验收和费用历史。财务独立资源完成关单，不给普通工单PATCH一个close旁路。

已关闭工单最后一笔成本纠错，先由明确的财务reopen-cost-review命令回到待核成本，再走原冲正及替代来源；不撤销物理验收。仍有有效人工付款/保险款登记时不可直接冲正。人工保险款仅记录真实收款凭据，不创建Payment、不自动抵销成本或推导客户应付款。

## 必须先验证的行为

- 跨车/跨客户ServiceRequest拒绝，按事件时点的VehicleAssignment证据核对；不使用订单初始vehicleId替代换车后的归属。缺历史证据时保留独立工单方式，不伪造关联。
- 新占车/交付与设置限制同车竞争，真正生效只有一方；安全还车仍可办理，单纯到期提醒不自动禁用车辆。
- 运营验收和财务确认分权，同键重放前校验当前岗位；终态记录和原证据不可覆盖。
- 同车同月两笔合法维修都可确认，同一费用来源仅确认一次；BAAS重叠和MANUAL累计超额仍拒绝。
- 工单需要成本而无有效COST、存在未决DRAFT/SCHEDULED时拒绝财务关单；错误金额先冲正后明确替代，不PATCH冻结金额。
- 迁移fresh-schema raw SQL校验NULL、JSON null、数组元素、金额、状态、同车FK与来源互斥；只在guard本机隔离库运行。后台及四入口联调后再算可上线功能。

本阶段不引入客户/资产方费用分摊或追偿收费规则；这些需要明确合同依据后另行确认。
