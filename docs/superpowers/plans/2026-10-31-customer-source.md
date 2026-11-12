# 客户来源最小增量

依据需求客户来源与固定旧提交 `db4b48c55890f11f52c4fc52c29242d7c0d150be` 的 nullable sourceChannel（最多64字）。沿用已授权计划后直接施工；不建立渠道主数据、返佣或自动归因。

- 主控追加 Customer.sourceChannel nullable、sourceRevision default0，迁移不猜填历史。SQL约束版本非负、来源非空白且最多64字符。
- 独立 GET/PATCH `/admin/customers/:id/source`；当前 ADMIN/OPERATIONS，明确 authVersion，持 Customer 锁。PATCH为 sourceChannel string|null、sourceRevision、reason、idempotencyKey；以独立sourceRevision CAS、事务幂等和前后审计保存。空白文字不代替null清除。
- 不能通过普通客户PATCH或客户自助profile改来源；资料资格hash、证件与订单历史快照不因来源变化重新计算。非运营通用客户投影不增加来源、版本或原因。
- 后台在客户详情追加来源区，现有姓名/电话查询保留；来源专用筛选仅ADMIN/OPERATIONS，列表和总数同scope，不能让其他岗位借筛选推断来源。
- 先验证输入/失权/同键回放/资料hash不变，再guard实际HTTP并发、旧入口旁路、SQL NULL/空白/长度，最后接页面并核验恢复/换岗行为。

本计划不改变催收、合同政策和客户资料人工审核。客户来源不是申请办理入口 SELF_SERVICE/SALES_ASSISTED。
