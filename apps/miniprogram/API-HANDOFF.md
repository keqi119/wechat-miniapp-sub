真实接口以 ../../docs/api-contract.md 为准。适配器 src/services/api.js 保持源公开服务方法；getContext 同步读取有效会话快照，refreshContext 异步回读服务端。所有写入只调用 /api/customer/*，公开浏览调用 /api/public/*。

生产错误不会退回样例，401清会话，403/404/409/供应商失败分别保留错误码；最终方案确认传revision+commercialHash；申请传documentId/version；附件传fileIds；里程传orderId/readingKm；交接传manifestHash/readFileIds。接口版本变化须同步测试。

信用第一阶段：GET /customer/applications/:id/credit-review；POST /credit-consent {documentId,version,decision:ACCEPT|DECLINE,idempotencyKey}；POST /credit-consent/withdraw {consentId,idempotencyKey}，两写接口返回同safe。safe新增canDecline、consentRequirementsMet、verificationCurrent、canConfirmFinalPlan；canFinalize属于后台出具动作，原生不依赖它。最终方案须固定creditVerificationId/creditRuleVersion/creditBand/creditRevision，客户确认前与当前有效核验匹配。DECLINE/withdraw不以一般隐私补签为前提。详情加载信用失败仅阻止信用操作及方案确认，不阻断已获授权的申请只读展示。
