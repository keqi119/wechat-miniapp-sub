# 支付验收后台实施记录

2026-10-16；范围仅`apps/admin`。

按补充计划与实际API契约新增`payment-verifications`资源，位于“资金与账务 / 支付验收”。仅ADMIN角色且具有`payment-verifications.read`权限可见与访问；写动作另要求对应write权限。

新增授权表单仅`customerId,authorizationNote`，明确固定0.01元、24小时有效、客户自行确认付款，不生成订阅订单/合同。列表及只读详情展示金额、币种、状态、有效期、创建与可信到账时间；已建授权不能编辑，没有代客户支付动作。关闭操作要求服务端`canClose === true`且状态为AUTHORIZED/CREATING/PENDING，SUCCEEDED与其余终态始终隐藏。未知状态或缺失canClose默认拒绝。

详情字段使用白名单，剔除OpenID、预支付凭证与原始支付参数；正常账单、支付、退款行为没有修改。

TDD先记录3项新行为失败，再实现；API确认canClose后进一步先失败再收紧缺失字段的拒绝逻辑。最终`pnpm --filter @chundian/admin test`为33/33通过，`pnpm --filter @chundian/admin build`通过（TypeScript+Vite）。产物JS305.65KB/gzip96.99KB。

本次仅单元测试和构建，没有调用生产API、上传、真实支付、签署或短信，也未创建验收授权记录。端到端授权/关单由主控在实际API部署与明确测试范围内验收，本记录不声称已实际收款。

## 独立审查与人工核对集成

只读审查API的支付验收模块、010迁移、微信网关改动和访问控制；没有修改API或运行占测试库的API测试。发现并同步修复两项：

- P1：`apps/api/src/payment-verification/controller.ts:18`默认`status=''`会被枚举校验拒绝，后台列表首次加载400；已复读空串预处理修复，非空未知值仍拒绝。真实HTTP红绿由API实现人员执行。
- P2：首次下单未知且渠道无单，24小时后pay禁止恢复、query保留CREATING、close返回404，记录缺少可完成的终结路径。已复读`service.ts:145`与`finishClose:159`修复：原到期加10分钟后可信签名缺单才可标记EXPIRED，并保留未知状态说明；`create:50`继续禁止此类已发起记录再次授权。关单在外呼前及完成写入时验证有效租约与令牌，CAS防旧请求覆盖，成功回调优先，迟到可信成功仍可落账。

后台随后按主控授权补齐safe的`manualReviewRequired/statusMessage`白名单及醒目“需人工核对”事实卡。到期未知场景明确写明“不能据此认定未扣款或再次授权”；没有把EXPIRED描述为确定未付款。新增回归先失败后通过，最终34/34后台单元测试及TypeScript+Vite构建通过（JS306.46KB/gzip97.22KB）。

最终源码审查未发现其余阻断问题：DB固定1分/CNY、ADMIN-only和客户会话归属、当前协议/OpenID、原trade重试、可信签名/app/mch/金额/payer校验、终态不覆盖成功、safe不泄露凭据均具备。API人员报告专项回归18/18，本审查未自行运行该测试，不将其当真实微信扣款证据。人工核对仍需实际渠道核账，不提供自动二次授权或退款。

后台再次冻结；本轮没有调用生产或真实交易。
