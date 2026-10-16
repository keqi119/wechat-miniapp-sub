# 申请级人工信用核验后台实施记录

2026-10-16，范围仅`apps/admin`，未提交、部署或修改其他目录。

申请详情新增独立`GET /admin/applications/:id/credit-review`事实卡，仅ADMIN/OPERATIONS读取。展示当前已发布说明全文及版本、客户本申请授权/撤回时间、核验档位/人员/时间/编号、信用版本和规则版本；无授权或说明未就绪时显示等待客户，不提供后台代授权动作。

录入动作`POST .../credit-verifications`仅提交`consentId,creditRevision,band,customerPresented:true,idempotencyKey`。5档为GE750/B700_749/B650_699/LT650/UNVERIFIABLE，客户主动出示声明默认未勾选且必须确认；没有精确分数、截图、自由备注或审核人/时间字段。每次打开录入表单分配一个请求键，同一表单失败重试沿用；写后刷新申请与信用状态。

前端动作要求本applicationId、当前说明ID/版本、ACCEPTED未撤回授权及服务端canVerify/canFinalize均匹配，读取失败或状态未知时默认隐藏核验/方案入口。最终方案绑定最新creditVerificationId，并只读展示信用版本与规则；押金只读随月费实时预览，0/1/2倍采用精确整数分且校验溢出。depositAmount预览不进入提交DTO，由服务端计算并校验。低于650/无法核验转人工处理，不发布正式方案。历史已确认方案保留当时核验及押金事实。

测试先失败后实现，新增覆盖档位与519900分月费的0/519900/1039800结果、溢出、缺少/跨申请/旧版本/撤回授权阻断、严格DTO与主动出示声明、稳定请求编号、最新核验替换旧绑定以及押金覆盖值不提交、拒绝授权与低档位不混淆、一般隐私同意独立提示。最终后台39/39单元测试、TypeScript+Vite构建通过，JS314.94KB/gzip99.86KB。

本次没有调用真实信用、生产API、支付或签署，也未替客户接受授权。端到端核验仍须API迁移及当前说明发布后，用客户真实独立点击的授权推进。旧qa-review脚本的无信用核验方案流程已不符合新前置条件，不能用它绕过客户授权或回填假核验；本记录不声称该流程已端到端通过。

## 信用API独立只读复查

应实现人员请求，只读核对`apps/api/src/applications/credit-review.ts`、`applications.ts`、011迁移与safe投影，没有修改API或运行DB测试。当前说明、申请级归属、严格5档字段、后端核验人时、0/1/2倍押金、核验ID/版本绑定、幂等与撤回/确认串行竞态、已确认订单历史金额保留未发现阻断。

发现一处最小必要读取边界并由主控确定修复：专有信用GET原沿用通用applications.read，FINANCE/SUPPORT可读信用档位；普通申请/订单也可透出新信用字段。已复读修正：`credit-review.ts:49`显式仅ADMIN/OPERATIONS，`operations/admin.ts:20`递归删除creditBand/creditVerificationId/creditRevision/creditRuleVersion，列表`:39`与详情`:44`均传入角色并应用safe。财务/客服仍读原押金金额；客户本人及ADMIN/OPERATIONS保留完整信用事实。不修改既有财务业务权限。

API同事报告信用HTTP专项9/9通过；本审查只复读实现与测试源码，不冒称自行运行API测试或完成真实信用核验。后台最终39/39单测及构建通过，代码冻结，无剩余独立审查阻断项。
