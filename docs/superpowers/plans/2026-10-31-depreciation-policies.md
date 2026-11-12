# 折旧策略与共同成本台账实施计划

日期：2026-10-31。承接已授权的资产设计与已完成的折旧纯计算；不依赖牌照模块，不修改客户收费。

## 结构及范围

使用已迁移 `VehicleDepreciationPolicy`，复用 `vehicle-depreciation/schedule.ts`、`asset-costs/source.ts`、共用命令与专用附件。仅ADMIN/FINANCE读写；OPERATIONS不得读取策略基数和依据。根负责schema/注册/权限，B仅写 `apps/api/src/vehicle-depreciation/`（现有schedule不可无故改写）及相应测试；共同台账目录归A，接口变更先双方确认。

共用来源已锁定：`depreciationTerms(row)`生成规范条款，`loadCostSource`读取真实策略并验hash；`previewCostPlans/generateCostPlans`接受`{sourceKind:'DEPRECIATION',manualPeriods?:[{costPeriod,amount,reason}]}`。每份计划冻结源、算法、原请求和精确期间行，来源确认再次计算校验。MANUAL不得直接提交任意成本分录。

## 具体任务

- [x] 锁定严格DTO：创建包含vehicleId/vehicleRevision/revision:0/key、method、basisAmount/basisSource/basisEvidence/residualAmount/startDate/usefulLifeMonths?、notes；只允许CNY；previousPolicyId可选。修改仅DRAFT且带revision/key，不接受vehicleId/status/确认金额。
- [x] GET/POST `/admin/depreciation-policies`、GET/PATCH `/:id`；标准分页并按vehicleId/status筛选。详情返回显式政策字段、最小车辆身份、专用附件、已有计划与已确认/冲正/锁定合计，不输出数据库内部或客户字段。
- [x] POST `/:id/activate`：当前工作人员→车辆→相关策略锁；版本与幂等、真实依据、日期/公式及专用附件核验。一车仅一ACTIVE。NONE须明确不计提依据，不能生成零金额“已计提”事实。
- [x] 若previousPolicyId存在，使用明确 `previousRevision` 及承接原因；当前ACTIVE必须匹配该前策略，锁后同事务把前策略SUPERSEDED并启用本策略。不覆盖历史基数/计划。新的起算期间若与有效旧计划/未冲正已确认期间重叠，拒绝并列出应先处理的计划；不隐式作废旧未来计划。要求明确填剩余基数/残值/月数，展示前策略净已提与承接资料供核对，不用市场估值或月租猜测。
- [x] POST `/:id/archive`：带revision/key/reason，只改变策略状态，不撤销已生成或已确认成本；已启用历史保持可查。禁止普通PATCH改启用后的金额依据。
- [x] POST `/:id/cost-preview` 是只读试算，body为严格生成请求（MANUAL必须显式最多120个不重复月份、整数分金额和逐期理由；其他method不接受manualPeriods）。返回共同preview结构，可附前策略净额与说明，但不能在查询时创建策略/计划/审计。
- [x] POST `/:id/cost-plans`：revision/key/previewHash及原请求，警示空数组；复用共同生成，已有包括VOIDED的期间跳过；累计有效计划和未冲正成本不能超该策略可折旧额，不能拆成多个MANUAL请求规避。事务内更新策略revision并留审计，不调用资金渠道。
- [x] 成本确认/重开由A共同服务办理；B与A核对累计上限、SUPERSEDED/ARCHIVED已生成历史确认语义及MANUAL快照，缺实现时显式拒绝，不能接受任意JSON来源。
- [x] 先红测：岗位/失权重放、严格金额日期/公式、NONE空试算、MANUAL累计请求上限、已启用不可改、同车双ACTIVE、承接不改历史/不重叠、预览变更409、同键重放及并发。根授DB独占后通过guard跑实际HTTP+DB，交限定diff/manifest/证据。

后台后续分派，待真实API及共同成本边界通过后再进入菜单。高级已确认期间纠错、自动市场残值调整不在此阶段实现。

实施状态：上述后端任务已通过限定复核与本地验证，具体批次见施工证据；页面与生产发布另行验收。
