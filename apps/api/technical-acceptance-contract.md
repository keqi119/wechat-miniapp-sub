# 独立技术签署验收 API（2026-10-16）

仅绑定既有 customerId，不关联商业订单。供应商 kind=TECHNICAL_ACCEPTANCE；原生 kind=technical-acceptance。独立开关 TECHNICAL_ACCEPTANCE_SIGNING_ENABLED 默认 false；正式签署开关保持独立。

## 安全详情

`{id,verificationNo,title:'电子签署流程验证确认书',customerId,revision,status,signatureStatus,createdAt,confirmedAt,stoppedAt,completedAt,retentionDueAt,retentionStatus,legalHold,document,sourceFileId,signedFileId,approval,enabled,consentRequirementsMet,canConfirm,canPrepare,canSign,canSync,canStop,canReviewRetention,canPurge,statusMessage,blockers,disclosure}`。

- status: AWAITING_CONFIRMATION / CONFIRMED / PENDING / SIGNED / STOPPED / REJECTED / EXPIRED / PURGED。停止与迟到签署事实分开：stoppedAt 始终保留；signatureStatus 为 DRAFT/PENDING/SIGNED/REJECTED/EXPIRED，只有双方可信签署+归档为 SIGNED。
- document: `{id,type:'technical-signing-verification',version,title,templateHash,bodyHash,documentHash,sourcePdfHash,content}`；content 是已解析全文，不含完整手机或证件号。列表只返回上述基础状态/能力和 document 的 hash/版本，省 content、disclosure、PDF ID。
- approval: `null | {id,status,expiresAt,requesterId,approverId,planHash}`。能力来自服务端，缺省不得推断允许。
- disclosure: `{version:'1',text,privacyDocumentId,privacyVersion}`，本人确认时独立未默认勾选。内容说明本份文件、实名姓名/已绑定手机号/法大大客户关联及签署凭据提供给法大大，仅此次验证及180天规则。
- enabled 只表示独立验收开关；canSign 还要求本人确认、有效双人复核、原生入口及供应商配置。关闭/停止仍可读取、核对已发出任务和归档，不发新签署或企业章。
- retentionStatus: RETAINED / REVIEW_DUE / HELD / PURGED。purge 为授权人工操作，实际删除本验证独立文件并匿名化独立数据；共享实名/证书不删。存在渠道未决/争议/法定留存时不允许清理。

## 后台（仅 ADMIN / OPERATIONS）

- GET `/admin/technical-acceptances?page=1&pageSize=12&status=&keyword=` → `{items,total,page,pageSize}`。keyword 按编号/id；空status忽略。
- GET `/admin/technical-acceptances/:id` → 安全详情。
- POST `/admin/technical-acceptances` `{customerId,documentId,idempotencyKey}` → 安全详情。documentId 必须已批准发布的 technical-signing-verification；只用现有已实名姓名生成正文及冻结PDF，不接任意正文/金额。已有未终结文件拒绝新建；修改采用新文件，旧事实不可覆盖。
- POST `/:id/prepare-signature` `{revision,policyId,idempotencyKey}` → `{record:详情,approval:审批摘要}`。本人确认后申请，另一实际人员仍走既有 `/admin/esign-approvals/:id/approve`，不是此动作自动批准。
- POST `/:id/stop` `{revision,idempotencyKey}` → 详情。不宣称渠道撤销。
- POST `/:id/retention-review` `{revision,idempotencyKey,legalHold:boolean,reason:string}` → 详情。明确争议/法定必要留存理由；仅 ADMIN，期满审核并决定保留或允许清理，不自动删除。
- POST `/:id/purge` `{revision,idempotencyKey,reason:string}` → 详情。仅 ADMIN，已满180天、人工审核释放、无在途/活跃lease/未结争议才可执行；重复键返回同结果。
- 新权限 `technical-acceptances.read/write` 仅 ADMIN / OPERATIONS。法律类型选项增加 technical-signing-verification；策略 kind 增加 TECHNICAL_ACCEPTANCE。

## 本人（Bearer）

- GET `/customer/technical-acceptances` → `{items}` 安全摘要；未分配则空。
- GET `/customer/technical-acceptances/:id` → 安全详情；非本人404。
- POST `/:id/confirm` `{revision,documentHash,bodyHash,templateHash,idempotencyKey,consent:{accepted:true,disclosureVersion:'1',privacyDocumentId,privacyVersion}}` → 详情。阅读全文并独立选择同意；当前terms/privacy门禁；绝不以既有实名同意替代。
- POST `/:id/sign` `{revision,idempotencyKey}` → `{taskId,url,status:'PENDING'}`（与现有签页响应兼容）；短URL仅内存，之后重新GET详情。本人明确点击，沿原生严格URL/return门禁，不能由后台代发。
- GET `/:id/sign-status` → 完整安全详情（仅本地读取，无渠道副作用）。
- POST `/:id/sync` `{revision,idempotencyKey}` → 完整安全详情；本人主动核对渠道真实结果，允许既有双审范围内推进企业章。关闭/停止后仅核对，不新章。不能把回跳参数当成功。
- POST `/:id/stop` `{revision,idempotencyKey}` → 详情；签完仍可停止后续验证，不否认已签事实。
- 已有 GET `/customer/files/:id` / `/admin/files/:id` 鉴权二进制下载；仅本人/ADMIN/OPS，sourceFileId 为本份冻结稿。

所有写操作遵循 revision+稳定 idempotencyKey。409 必须重新GET；同键同请求重放不二次确认/盖章，异体同键拒绝。详情/正文/短URL不进日志或持久前端缓存。没有任何付款、车辆、信用或权益动作。

一般 terms/privacy 同意过期时 consentRequirementsMet=false 且 canConfirm=false；本人到既有账户设置阅读并用 POST /customer/consents 明确更新，再返回确认。独立验收专项同意不替代一般协议。
