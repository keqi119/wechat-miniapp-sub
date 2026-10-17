# 独立平台 API 契约 v1

基地址 `/api`。原生客户使用 `Authorization: Bearer <session>`；后台使用 HttpOnly Cookie，修改请求携带 `X-CSRF-Token`，服务端校验 Origin。JSON 错误为 `{error:{code,message,details?},requestId?}`。金额整数分；时间 ISO8601，业务时区 Asia/Shanghai。成功列表统一 `{items,total,page,pageSize}`，客户展示聚合返回原 Mock services 对应展示模型。

## 公开与客户

| Method | Path | 输入/输出 |
| --- | --- | --- |
| GET | /health | `{status,version,database}` |
| GET | /public/vehicles | query brand,keyword,page,pageSize；车辆列表 |
| GET | /public/vehicles/:id | 车辆、可售套餐、车况和媒体 |
| GET | /public/model-definitions | 车型列表 |
| GET | /public/legal/:type | 已发布协议 `{id,type,version,title,content}` |
| POST | /customer/auth/wechat | `{loginCode,phoneCode}` → `{token,expiresAt,customer}` |
| POST | /customer/auth/sms/request | `{mobile}` → `{sent:true}`；不可回传验证码 |
| POST | /customer/auth/sms/login | `{mobile,code,loginCode?}` → 同上；支付前须取得本小程序 OpenID |
| POST | /customer/auth/logout | 撤销当前会话 |
| GET | /customer/context | 客户会话及 profile |
| GET | /customer/home | 原 getHome 展示模型 |
| GET | /customer/dashboard | 原 getDashboard 展示模型 |
| PUT | /customer/profile | `{name,drivingYears,...profileFields}`；手机号另行认证 |
| POST | /customer/files | multipart file, purpose → `{id,name,url,mimeType,size}` |
| GET | /customer/files/:id | 归属校验后文件 |
| POST | /customer/applications | `{vehicleId,subscriptionPlanId,profile,consents:[{documentId,version}],idempotencyKey}` |
| GET | /customer/applications/:id | 原 getApplication 展示模型 |
| POST | /customer/applications/:id/cancel | `{reason?}` |
| POST | /customer/applications/:id/confirm | `{revision,commercialHash}` → 订单信息 |
| POST | /customer/applications/:id/reject | `{revision,reason}` |
| GET | /customer/records/:type | 类型 applications,orders,contracts,bills,payments,deposits,entitlements,notifications,services |
| GET | /customer/records/:type/:id | 原 getRecord 展示模型；动作由服务端提供 |
| POST | /customer/contracts/:id/sign | `{}` → `{taskId,url?,miniProgram?,status}` |
| GET | /customer/contracts/:id/sign-status | 真实签署状态 |
| POST | /customer/bills/:id/pay | `{idempotencyKey}` → `{paymentId,timeStamp,nonceStr,package,signType,paySign}` |
| GET | /customer/payments/:id | 真实付款状态 |
| POST | /customer/notifications/:id/read | 持久化已读 |
| POST | /customer/services | `{type,location,description,mobile,fileIds,idempotencyKey}` |
| POST | /customer/services/:id/cancel | `{reason?}` |
| POST | /customer/mileages | `{orderId,readingKm,recordedAt,fileIds,idempotencyKey}` |
| GET | /customer/handovers/:id | 证据、清单哈希、确认/签署状态 |
| POST | /customer/handovers/:id/confirm | `{manifestHash,readFileIds,idempotencyKey}` |
| POST | /customer/handovers/:id/object | `{manifestHash,reason,fileIds,idempotencyKey}` |
| POST | /customer/handovers/:id/sign | 与合同签署结果格式相同 |

匿名首页可从公开目录组合，客户 home/dashboard 需会话。原页面上传后的 fileId 应随业务请求提交，不能把外部 URL 直接当私密附件。所有客户 ID 均取自会话，不接受前端指定归属。

## 管理后台

认证：`POST /admin/auth/login {username,password}` → `{user,csrfToken}` + Cookie；`GET /admin/auth/me` → 同结构；`POST /admin/auth/logout`。

`GET /admin/dashboard` → 待办计数与最近活动。

资源根路径：`/admin/model-definitions`、`vehicles`、`plans`、`customers`、`applications`、`orders`、`contracts`、`bills`、`payments`、`deposits`、`refunds`、`handovers`、`mileages`、`entitlements`、`services`、`notifications`、`users`、`audit-logs`、`legal-documents`。列表支持 page/pageSize/keyword/status，详情 GET /:id。只有允许编辑的资源提供 POST/PATCH；财务/订单/审计状态通过明确动作修改，不能任意 PATCH。

车辆表单字段：`brand,model,title,year,city,mileageKm,batteryHealthPercent,description,conditionDisclosure,coverFileId,mediaFileIds,status`；公开价格来自绑定有效套餐，不直接接受展示字符串。

套餐字段：`vehicleId,name,months,monthlyFeeAmount,mileagePerMonthKm,excessMileagePriceAmount,energyDescription,benefits:string[],conditions,active`。

动作接口均 POST：

- `/vehicles/:id/publish`、`/unpublish`；`/plans/:id/activate`、`/deactivate`。
- `/applications/:id/review {decision:'IN_REVIEW'|'NEEDS_INFO'|'REJECTED',note}`。
- `/applications/:id/final-plan {revision,creditVerificationId,monthlyFeeAmount,months,mileagePerMonthKm,excessMileagePriceAmount,energyDescription,benefits,conditions,startDate,firstDueDate,commercialTerms}`；服务端按当前有效信用档位计算depositAmount，若兼容传入该金额则须严格一致。生成新revision和commercialHash，绑定核验ID、规则、档位与信用版本。
- `/contracts/:id/send`、`/sync`；`/bills/:id/publish`；`/payments/:id/sync`。
- `/refunds {paymentId,amount,reason}` 建立审核请求；`/refunds/:id/approve`、`/reject {reason}`。
- `/handovers {orderId,type,readingKm,fileIds,checklist}`；`/handovers/:id/publish`、`/complete`。
- `/mileages/:id/review {decision:'APPROVED'|'REJECTED',note}`。
- `/services/:id/assign {assigneeId?,providerName,contact,note}`；`/services/:id/status {status,note}`。
- `/legal-documents/:id/publish` 要求已记录用户正式文案确认；先只保存草稿。
- `/files` multipart 上传；`/files/:id` 授权读取。

后台默认角色 ADMIN、OPERATIONS、FINANCE、SUPPORT；关键动作权限在服务端强制执行。前端可依据服务端 `permissions:string[]` 隐藏动作。

## 本申请的人工信用核验

`GET /customer/applications/:id/credit-review` 与 `GET /admin/applications/:id/credit-review` 返回申请级safe状态。客户限本人；后台信用读取及录入仅ADMIN/OPERATIONS。FINANCE/SUPPORT的普通申请/订单响应移除信用档位、核验ID、规则与信用版本，保留业务所需押金金额。

客户独立操作：

- `POST /customer/applications/:id/credit-consent {documentId,version,decision:'ACCEPT'|'DECLINE',idempotencyKey}`。ACCEPT要求当前terms/privacy已同意，并绑定当前已发布credit-verification文案；一般同意不能替代本申请的明确选择。
- `POST /customer/applications/:id/credit-consent/withdraw {consentId,idempotencyKey}`。撤回后不能继续核验或确认未成立方案；历史已确认订单不被改写。
- `POST /admin/applications/:id/credit-verifications {consentId,creditRevision,band,customerPresented:true,idempotencyKey}`。band只能为GE750/B700_749/B650_699/LT650/UNVERIFIABLE。核验人与时间取服务端，不接受精确分数、图片、自由证据备注或客户端指定操作人。

safe包含current document、申请独立consent、最新verification、creditRevision、ruleVersion、status，以及 `canConsent/canDecline/canWithdraw/canVerify/canFinalize/consentRequirementsMet/verificationCurrent/canConfirmFinalPlan/depositMultiplier`。客户确认使用canConfirmFinalPlan和方案绑定快照，不能误用后台canFinalize。

核验历史追加保存；新核验或授权变化使尚未确认方案回到审核并更新版本，旧版本确认被拒绝。前三档月费倍数为0/1/2，后两档转人工并禁止最终方案。后台可读状态不等于已获客户授权。

## 指定申请的真实订单验收报价

`POST /admin/applications/:id/final-plan` 可选 `pricingMode: STANDARD | V1_ONE_FEN`，默认 STANDARD。仅匹配服务器 `ORDER_ACCEPTANCE_SCOPE_JSON` 的申请、客户、车辆和日期允许 ADMIN 选择 V1_ONE_FEN；仍须有效的本申请信用授权与核验。该模式限定12期各1分和一次1分押金，不改变信用档位或公开套餐。服务器生成 `acceptancePricing` 快照并纳入方案摘要，禁止客户端提交该字段。

管理员信用核验视图对匹配申请增加 `acceptancePricing` 报价提示；其他角色无该选项。客户方案返回 `pricingMode` 与 `pricingDescription`。确认前复核配置和信用版本；已确认订单的重复请求返回原订单，随后关闭配置不改写历史价格。财务/客服不能读取快照中的 `standardDepositAmount`。配置说明见 `controlled-order-pricing.md`。

## 指定客户的 0.01 元支付验收

与 `Bill/Payment/Order` 分离，不改变正式报价，不创建订阅或合同。服务端固定 `amount=1`、`currency=CNY`，默认关闭独立开关。创建授权后24小时内可发起；已在渠道处理中即使过期仍须查询或关单，不自动重新建单。

| 方法 | 路径 | 输入/返回 |
|---|---|---|
| POST | /admin/payment-verifications | 仅ADMIN；`{customerId,authorizationNote}` → safe记录 |
| GET | /admin/payment-verifications | 仅ADMIN；分页 `{items,total,page,pageSize}` |
| GET | /admin/payment-verifications/:id | 仅ADMIN；safe详情，含 `canClose` |
| POST | /admin/payment-verifications/:id/close | 仅ADMIN；查询并按可信渠道结果关闭未付单 → safe记录 |
| GET | /customer/payment-verifications | 仅当前客户；`{items}` |
| POST | /customer/payment-verifications/:id/pay | 当前客户、OpenID、当前协议同意；返回 `{verification,paymentParams}` |
| POST | /customer/payment-verifications/:id/query | 当前客户；可信渠道查询 → safe记录 |
| POST | /callbacks/wechat-pay-verification | 独立验签回调，已登记交易号/1分/CNY及商户应用核验后原子落账 |

safe记录至少含 `{id,amount,currency,status,expiresAt,createdAt,paidAt,canPay,canClose,title,manualReviewRequired,statusMessage}`；状态为 `AUTHORIZED/CREATING/PENDING/SUCCEEDED/CLOSED/FAILED/EXPIRED`。不返回OpenID、预支付ID或供应商原始响应。`paymentParams` 只通过本人已授权发起请求即时返回，客户端不持久化、不写日志。

客户同一时刻不能有第二笔非终态授权，已成功验收后禁止再次授权收费。发起遇可信渠道已终态返回409，客户端再query刷新；未知结果保留同一交易号查询。仅 `SUCCEEDED` 表示服务端已核实到账，客户端微信success不足以记账。退款不在此验收接口中执行。

已开始但渠道始终查不到的记录，只能由ADMIN在原授权到期10分钟后、无活跃请求租约且取得新的可信签名无单查询后结束为EXPIRED。此情况提示人工核对，不表示确定未扣款，保留原交易号并禁止同客户再次授权；迟到的可信成功仍可记账。短时无单、网络超时或验签失败不得据此结束记录。关闭写入校验对应租约，旧请求不能覆盖新的处理或已成功结果。

## 实现协调

API 实现人员负责把以上入口细化为 DTO、Prisma 实体与共享类型；新增必要字段写入本文并及时通知两个前端。支付和签署的具体 Gateway TypeScript 接口由 API 任务先定义，主控集成时适配接口，不以 placeholder success 代替第三方能力。
# 交还地点建议（2026-10-17）

`GET /public/handover-location`返回`enabled/mapEnabled/notice/policyHash`；notice只在当前已发布且与配置精确匹配时返回。配置规则见`docs/handover-location.md`。

申请提交及`POST /customer/applications/:id/amend`的profile可含可空的handoverLocation：

- 手填：`{source:"MANUAL",name:"地点名称（可为空）",address:"完整地址"}`。
- 地图：`{source:"MAP",name,address,accepted:true,policyHash:"本次展示的能力摘要"}`。
- name最多100字，address为2–500字；结构严格，不接收坐标、客户端同意时间或额外字段。地图需开关开启、当前文案摘要一致和独立同意。
- 服务器生成`consent:{customerId,documentId,version,contentHash,policyHash,acceptedAt}`。不把地图同意写成普通登录同意，也不由后台代客户勾选。
- 补件省略字段保留已有地点，null清除。仅当前客户、NEEDS_INFO状态允许新补件，幂等回放保留原结果。新增地点须当前隐私政策同意；清除不受此限制。
- 当前profile采用严格字段name/drivingYears/fileIds/mobile（mobile仅申请提交），防止通过扩展字段保存坐标。个人资料接口不承担交接建议存储。
