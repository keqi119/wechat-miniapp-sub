# B3 后台最小接线计划

依据 `docs/superpowers/plans/2026-10-16-paid-swap-credits.md`、`apps/api/b3-contract.md`；仅 apps/admin，不提交、不部署、不触碰共享数据库。API 同事已确认退款可在 ACTIVE/EXPIRED/PAYMENT_REVIEW/REFUND_PENDING（确定失败/拒绝且无进行中退款）时由严格 safe 能力开放。

1. 先补纯函数/资源测试：金额固定80000分一次、真实权限与能力、固定全额退款、稳定关闭/申请key、安全嵌套投影、晚到款/退款未知冻结提示。
2. 复用 ResourcePage 添加只读购买来源列表/详情与财务关闭动作；不提供新增、编辑、购买、代付或手工发次数。
3. 专用详情展示账单/付款/退款/预占/消费/说明版本、有效末日及中文阻断；例外退款固定原payment+80000分，仅运营说明reason可填，复用已有双人审核/sync/retry页面。
4. B2账户增加五项真实付费计数、购买来源与专门说明/购买阻断，账本支持purchaseId和GRANT/FREEZE/EXPIRE/REFUND；服务端没返回不推算余额，客户购买入口不搬到后台。
5. 隔离浏览器验证角色/能力、未知款/退款冻结、409同key、空态/离线、390px；局部test/typecheck/build。
6. 等 API 完成并提供独立 `_ui_acceptance` 本地库/合成fixture时段后，再进行真实HTTP前端接线。fixture浏览器证据不得冒充该验收，更不代表生产付款/退款。
