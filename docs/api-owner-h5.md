# 合作商 H5 接口（v2.2，2026-10-28）

> **版本边界：v2.2代码及本地验收已完成，生产状态见[实施与发布记录](evidence/ninda-partner-operations-v22.md)。** 新合作商入口以[七模块API的v2.2附录](api-seven-module-mvp.md#v22接口附录合作运营与手机号只读查看)及[设计基线](superpowers/specs/2026-10-28-partner-operations-readonly-design.md)为准：后台独立配置手机号只读授权，不要求Customer注册或法人电子签关系；新portal会话与短信challengeId绑定独立授权版本。业务GET按精确白名单及对象授权，POST仅短信请求、登录、退出三个认证例外。档案/结算反馈、claim、身份刷新、授权、签署、sync等合作商业务写入口对新旧会话均拒绝，不能仅隐藏按钮或借旧链接绕过。历史文件、任务、账本与独立回调事实仍保留。
>
> 下文保留v2.1及更早法人/电子签的历史兼容说明；其中Customer绑定、邀请码、旧Session DTO、反馈和签署路径不再作为v2.2开通方式。新路由/DTO与旧字段的替代范围统一查阅上述附录；历史说明不能作为启用旧写入口的指令。

## 以下为 v2.1 历史兼容记录

新 MVP 同时支持企业与个人合作商，沿用 `/owner/` 独立会话及短信入口。企业代表关系、个人本人关系均须经过当前资料版本的独立准入审核；邀请码只用于领取身份，不替代合同授权、签名或支付指令。新工作区使用 [七模块接口增量](api-seven-module-mvp.md) 的 `/owner-h5/owners/:ownerId/*` 路径。

四个入口为合作、车辆、订单、结算。合作展示已审核的线下合作协议与分润规则；订单展示本人已授权范围内的签约及履约摘要；结算查看已发布结果、付款核对结果及反馈。只读已归档文件，不提供新电子签、选章、自动分账或提现入口。下面原法人认证/电子签接口仅说明历史兼容行为，不得作为本版新签署流程调用；`ESIGN_NEW_REQUESTS_ENABLED=false` 关闭新签署及新用印申请。

API `/api/owner-h5`，浏览器同源代理 `/owner/api`。成功响应直接返回下列 JSON；失败沿用现有 `{error:{code,message}}`。开启条件 `OWNER_LEGAL_H5_ENABLED=true` 且短信配置齐备；旧小程序迁出独立开关 `OWNER_LEGAL_H5_ONLY=true`。

## 登录

企业邀请码新签发固定为24个 Base64URL 字符（18字节安全随机数），历史43位码继续兼容。输入仅接受24位或43位，不接受中间长度、空白或其他字符；不改变手机号绑定、7天有效期、哈希存储及领取约束。邀请仅用于首次登录资格或补领企业，不作为会话、六位短信验证码或用印授权。

- GET `/config` → `{enabled,entryUrl,mode:"OWNER_LEGAL_H5"}`
- GET `/legal` → `{documents:[{id,type,version,title,content,contentHash}]}`：当前 terms/privacy/owner-identity，可选已审定发布 owner-auto-sign 和 owner-rental-contract。授权提交前必须展示与选项 ID、版本和内容摘要一致的完整合同模板。
- POST `/auth/sms/request` `{mobile,invitationToken?}` → `{accepted:true}`。仅匹配当前法人档案的有效邀请或已有未停用法人会员可发短信；不会暴露企业资料。
- POST `/auth/login` `{mobile,code,invitationToken?,consents:[{documentId,version}]}` → `{customer:{id,maskedMobile},csrfToken,expiresAt}`。登录同意 terms/privacy。首次必须有效邀请；后续可无邀请但必须存在有效法人会员。
- GET `/auth/me` 同登录响应；POST `/auth/logout` `{}` → `{success:true}`。
- 独立 Cookie `owner_h5_session`，路径 `/owner/`；写操作 `X-CSRF-Token`，登录及发短信也验证精确 Origin。

## 企业

- GET `/owners` → `[{ownerId,name,status,memberStatus,verificationDisplay}]`，仅当前法人档案匹配的企业。
- POST `/owners/claim` `{token}` → `{ownerId,memberStatus}`，已登录法人补领另一企业邀请。
- GET `/owners/:id` → 原 memberDetail 字段，加：
  - `legalRepresentative:{name,maskedMobile}`
  - `certificationComplete:boolean`：当前法人证据匹配、企业已实名且证书有效并在核验新鲜期内；独立于是否已选印章。（三项授权版本新增）
  - `authorizationEntryEnabled:boolean`：仅是否开放渠道授权办理。
  - `autoSigningExecutionEnabled:boolean`：自动用印总门禁；不代表本企业已启用。
  - `capabilities:{canStartVerification,canRefreshVerification,canSelectSeal,canRequestAuthority,canEnableAuthority,canManageAuthority}`
  - `blockers:string[]`：用户可读缺项
   - `verificationDisplay`：企业列表与详情共用的当前核验展示，字段见下。原始 `status/realNameStatus/certStatus/seals[].status` 保留历史办理事实，不能单独推导当前可签署。
- POST `/owners/:id/verification` `{accepted:true,consents:[...]}` → `{url?:string,status:string}`。分别同意 terms/privacy/owner-identity。已有完成认证接续可直接返回 VERIFIED，不重复注册。
- POST `/owners/:id/refresh` `{}` → detail；尚未由当前法人同意时拒绝并提示点“由法人本人办理认证”。
- GET `/owners/:id/seals/:sealId/image` → `{imageBase64,imageType}`
- POST `/owners/:id/seal` `{sealId}` → detail
- GET `/owners/:id/authority-options` → `{vehicles:[{vehicleId,vehicle:{title}}],template:{id,version,hash,title}|null}`
- GET `/owners/:id/authorities` → 既有 OwnerAuthorizationService.list 返回数组。
- POST `/owners/:id/authorities` → 既有 request 入参及响应，UI 必须按当前授权服务 schema 构造。
- POST `/owners/:id/authorities/:authorityId/{refresh,switch,revoke}` → 既有服务；switch 输入 `{enabled,scopeHash,revision}`，其他 `{}`。

`verificationDisplay` 为 `{state,label,message,certification:{state,label,message},seal:{state,label,message},checkedAt}`。整体 `state` 为 `READY / REFRESH_REQUIRED / INCOMPLETE / PROCESSING`；`certification.state` 为 `VERIFIED / REFRESH_REQUIRED / INCOMPLETE`；`seal.state` 为 `READY / REFRESH_REQUIRED / NOT_SELECTED / UNAVAILABLE`；`checkedAt` 为本地最近核验时间（ISO字符串）或null。字段用于解释核验证据，不能由客户端据此授予动作权限；服务端 `readyForSigning`、`canRequestAuthority` 与 `canEnableAuthority` 同时要求整体核验 `READY`，避免提示印章异常时仍显示可办理。其他入口条件以及认证、签署服务门禁仍独立检查，没有放宽。

已认证且证书曾为BOUND，但核验记录超过24小时，显示“待更新核验”，不将本地记录陈旧描述为供应商证书已过期；证书UNKNOWN或缺少证书序号显示尚未确认有效证书。ACTIVE印章仍显示已选用，核验陈旧时提示先更新核验，不要求重复选择。列表与详情使用相同展示口径，输出不包含供应商客户号、认证交易号、证书序号或新增法人身份字段。最终方案仍返回 `OWNER_NOT_READY`，错误消息按企业实名、有效证书证据、24小时核验、未完成核验任务、选章或印章归属分别说明；不改变原准入条件。

授权办理门禁为 `OWNER_AUTHORIZATION_ENABLED`；未配置时兼容原 `OWNER_AUTO_SIGNING_ENABLED`，显式 false 优先。它只允许本人发起渠道授权，不启用自动签署。渠道查询为 AUTHORIZED 后，本地 enabled 仍为 false。启用须 `OWNER_AUTO_SIGNING_ENABLED=true`、本人单独确认已保存完整范围并提交当前 revision/scopeHash；服务端重新核验渠道授权、法人、证书、印章和有效期。状态冲突只刷新，不自动重试启用。停用及撤销不因办理入口关闭而失效。实际订单执行继续受 `FADADA_SIGNING_ENABLED`、`OWNER_CONTRACTS_ENABLED` 及逐单校验约束。

仅明确 HTTPS 供应商来源 `realnameverify16.fadada.com` 和 `textapi17.fadada.com` 可打开；URL 仅在响应和短暂内存内，不持久化到浏览器存储/日志。固定返回 `/owner/return/` 不接收 URL 中的成功断言。

## 三项授权 v2（2026-10-21 已正式启用）

`OWNER_AUTHORIZATION_SCOPE_VERSION` 未配置或为1时保留v1新申请；为2时新申请只接受v2。v2必须读取已正式发布并确认的 `owner-auto-sign` 文案，版本至少2，且申请及幂等重入均要求企业账号已有法人H5办理标记并通过当前法人核验。授权取得、显式启用及真正自动执行仍为独立步骤，版本切换不会开启自动盖章。

v2 `GET /owners/:id/authority-options`：

```ts
{
 scopeVersion:2,
 delegates:[{id:'PLATFORM_OPERATOR',name:string}],
 documentKinds:[{id:'SUBSCRIPTION_WITH_FEES',label:string,
   template:{id:string,version:number,hash:string,title:string}}],
 authorizationNotice:{id:string,version:number,hash:string}|null
}
```

缺少可用模板时 `documentKinds` 为空，缺少新版已确认说明时 `authorizationNotice` 为null，不允许发起申请。新申请仍传 `sealId,accepted:true,consents,idempotencyKey`，`scope` 改为：

```ts
{version:2,validFrom:string,validUntil:string,
 delegates:[{id:'PLATFORM_OPERATOR',name:string}],
 documentKinds:['SUBSCRIPTION_WITH_FEES']}
```

主体及种类必须从服务端候选中明确选择；空值、重复、客户端伪造主体或不支持种类均拒绝。v2范围不包含车辆清单、金额或期数上下限、模板编号/版本。当前模板可供阅读，订单继续逐单冻结实际版本、正文、交易条件及文件摘要。发起v2授权不要求车库已有车辆；实际执行仍要求本单车辆归属审核及真实出租方一致。

历史v1授权保留原字段、摘要与执行限制，不转换或自动扩大范围。v2实际执行必须匹配当前平台、任务冻结和授权中记载的被授权主体；旧任务缺少主体快照时不得自动套用v2。SUBSCRIPTION_WITH_FEES仅覆盖汽车订阅主合同及同份PDF费用附件，不包含延期、换车、终止、结算、交接等文件。

H5认证完成时01仅展示结果；新鲜度过期优先查询，认证未完成/失效时恢复办理。02自动调用现有受保护的印章图样GET；该接口读取本地加密图样，不生成或选用印章，不请求供应商、不启动认证或授权。请求结果必须绑定当前会话及企业，图片不写浏览器持久存储。

## 单方授权书（2026-10-21 23:24 已发布部署）

`OWNER_AUTHORIZATION_METHOD=UNILATERAL_LETTER` 将新申请切换为自建 PDF、车主企业单方手动签署；默认 `PROVIDER_AUTO_GRANT` 保留旧方式兼容。此切换必须配合 scope v2、已确认发布的 `owner-auto-sign` v3 及 `owner-authorization-letter` v1。授权书被授权人固定为上海宁达信息科技有限公司，不从法大大 API 应用主体派生。

- 企业 detail 和 v2 options 增加 `authorizationMethod`。单方模式 options 另有 `authorizationLetterTemplate:{id,version,hash,title}|null`，缺少审定正文时不能发起。
- 申请 `consents` 额外包含 `owner-authorization-letter` 当前 ID 和版本；严格要求法人 H5 通道。生成前冻结企业身份、法人、证书、印章 ID/图样摘要、三项范围及正文模板。客户端无需传被授权人的渠道 ID。
- 单方模式不调用 `before_authsign.api`。源文件只上传一次，`extsign.api` 签署主体为实际车主企业；上传结果不明时先核对原合同文件，不重新上传覆盖。
- 回调仍走 `/api/callbacks/fadada-owner-authorization`，先验签并绑定原合同/交易/客户，再按记录 method 分流。原法人后来停用或关系变化，不妨碍可信晚到结果归档，但不恢复用户文件访问权限或授权效力。
- 记录新增 `method` 和 `document:{state,bodyHash,sourceSha256,signedPdfHash,sourceAvailable,signedAvailable,withdrawnAt,technicalAuthorizationStatus:'UNCONFIRMED'}`。单方状态为 `PENDING / SIGNED / REJECTED / WITHDRAWN`，可信查询且签后 PDF 归档均完成才记 `SIGNED`。业务授权文件始终 `enabled=false`，所有自动执行路径按 method 拒绝。
- GET `/owners/:id/authorities/:authorityId/document/source` 与 `/document/signed` 返回 `application/pdf`，使用法人 Cookie、禁止缓存、无 referrer；只允许当前已核验且为原申请人的法人读取。通用客户附件接口拒绝此文件类型，通用管理员附件仅 ADMIN/OPERATIONS 可读。
- POST `/owners/:id/authorities/:authorityId/resume` 继续原单方授权书，保留原文和交易号；须当前法人、入口开放、记录未签且未撤回，结果不明先查询。
- 单方 `revoke` 只撤回并停用本地授权，保留签后文件和晚到证据，不调用渠道账户级撤销。历史渠道撤销仅作用于 `PROVIDER_AUTO_GRANT`，不会改变单方记录。

仅签署本文件不构成法大大渠道自动签权限。渠道是否接受该单方授权书及如何配置，需另行取得供应商明确方案；本次不调用自动签章或替法人签署。

## 法人工作区与业务合同（2026-10-22）

页面按企业划分为“企业与印章 / 签约授权 / 业务合同”。签约授权保留正式三项范围，当前单方授权与历史渠道授权分别展示；操作反馈绑定企业和具体记录。历史记录不因页面调整而撤回或删除。

授权列表增加 `certificateMatchesCurrent:boolean|null`：只有本地企业证书有效且核验在24小时内才判断是否与冻结记录一致；证据过期或缺失返回null，先重新核验。旧证书未签件可提示撤回后重办，但前端不得自动撤回。旧渠道 `REVOKING` 查询失败仍为 `REVOKING` 且停用，不能把查询失败视为撤销成功。

以下相对路径均在 `/owners/:id/contracts` 下，沿用法人Cookie、精确Origin、CSRF与当前法人资格检查：

- GET `/`：`{items,signingMode:'MANUAL',manualSigningEnabled,automaticSigningEnabled:false}`。
- GET `/:taskId`：同一合同摘要，加已冻结 `body`。
- GET `/:taskId/files/source` 或 `/files/signed`：受保护PDF，禁止缓存；校验文件摘要、企业归属和客户资料提供同意。
- POST `/:taskId/sign`：严格传 `{accepted:true,documentHash,sourceSha256}`，本人核对同一PDF后领取手动签署；响应沿用 `{taskId,status,url}`。
- POST `/:taskId/sync`：传 `{}`，查询原交易并按可信结果归档；使用 `query(taskId,false)`，不能触发自动签章。

后台企业合同核验、原客户车主合同查询和订阅客户签署结果同步也统一使用非派发查询。可信供应商回调仍可进入原自动流程，但必须满足原全局、自动执行及有效渠道授权等全部门禁；本期这些自动门禁关闭。

`items` 的 `id` 为 `OwnerSigningTask.id`，`resourceId` 为业务合同ID。摘要包含 `kind,status,ownerMode,createdAt,archivedAt,reviewedAt,parties:[{role,status}],orderId,vehicleTitle,monthlyFeeAmount,depositAmount,months,documentHash,sourceSha256,sourceAvailable,signedAvailable,canSign,canQuery,blockers`；无法可靠提供的展示字段为null，金额均整数分。没有已准备文件时返回空列表，不虚构待签或作废合同。链接失效不代表业务合同到期。

手签仍检查实际出租企业、当前法人、客户单独资料同意、批准模板及冻结交易条件、证书/印章、运营PDF审核、客户已签可信证据。已发出的签署沿用原交易和文件；未知结果先查询，不切换模式或创建第二笔签章。

`OWNER_MANUAL_CONTRACTS_ENABLED=true` 与 `OWNER_CONTRACTS_ENABLED=true` 可独立开放实际车主合同的客户本人签署及法人逐单手签。`FADADA_SIGNING_ENABLED` 和 `OWNER_AUTO_SIGNING_ENABLED` 继续控制原平台/自动流程，新手动开关不满足自动执行门禁。本期H5固定逐单手动确认，自动模式未开放；签署单方授权书不会改变此状态。

## 宁达平台交接单（2026-10-25）

服务号业务合同页同时读取现有出租方合同和平台交接单，两类记录使用各自接口和任务编号。宁达交接单采用客户先签、宁达法人逐份手动签、双方完成后归档；后台按同份文件双人复核保持有效。该流程不需要将宁达授权给晓浪自动盖章。

以下路径相对 `/owners/:ownerId/handovers`，沿用法人 Cookie、精确 Origin 和写入 CSRF 校验：

- GET `/`：与原合同列表格式一致，`items` 中 `documentDomain='PLATFORM_HANDOVER'`、`kind='HANDOVER'`，`id` 为 `FadadaTask.id`；`handoverType` 为原交接类型。其他真实车主返回空列表，不能读取宁达交接任务。
- GET `/:taskId`：同一交接摘要，签署方角色为 `CUSTOMER / PLATFORM`。完整冻结 PDF 是本份交接文件的阅读及签署依据，`body` 可为空。月租、押金、期数等不适用于交接展示的字段不伪造。
- GET `/:taskId/files/source|signed`：受保护 PDF，核验企业、任务、当前业务记录与文件摘要；无公开文件地址。
- POST `/:taskId/sign`：`{accepted:true,documentHash,sourceSha256}`。服务端重新核验本人法人关系、认证、证书、已选宁达章、客户已签证据、平台章映射及有效双人审批，使用当前任务的原合同和平台交易号进入法大大手动签页。
- POST `/:taskId/sync`：`{}`，查询同一任务的可信签署结果并归档；手动任务不调用自动盖章。归档成功后同步交接签署状态，不代替实际交车、还车或结算完成操作。

新任务由 `HANDOVER_PLATFORM_SIGNING_MODE=MANUAL` 冻结手动模式，历史 AUTO 任务不转换。关闭新签入口不抹去已发生的可信签署结果。文档、证书、法人关系、印章或审批变化后，不能凭先前页面勾选直接领取新的签署入口；需重新查询并按服务端当前阻断处理。
