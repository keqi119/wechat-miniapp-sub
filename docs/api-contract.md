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
- `/applications/:id/final-plan {revision,monthlyFeeAmount,depositAmount,months,mileagePerMonthKm,excessMileagePriceAmount,energyDescription,benefits,conditions,startDate,firstDueDate}`；服务端产生 revision 和 commercialHash。
- `/contracts/:id/send`、`/sync`；`/bills/:id/publish`；`/payments/:id/sync`。
- `/refunds {paymentId,amount,reason}` 建立审核请求；`/refunds/:id/approve`、`/reject {reason}`。
- `/handovers {orderId,type,readingKm,fileIds,checklist}`；`/handovers/:id/publish`、`/complete`。
- `/mileages/:id/review {decision:'APPROVED'|'REJECTED',note}`。
- `/services/:id/assign {assigneeId?,providerName,contact,note}`；`/services/:id/status {status,note}`。
- `/legal-documents/:id/publish` 要求已记录用户正式文案确认；先只保存草稿。
- `/files` multipart 上传；`/files/:id` 授权读取。

后台默认角色 ADMIN、OPERATIONS、FINANCE、SUPPORT；关键动作权限在服务端强制执行。前端可依据服务端 `permissions:string[]` 隐藏动作。

## 实现协调

API 实现人员负责把以上入口细化为 DTO、Prisma 实体与共享类型；新增必要字段写入本文并及时通知两个前端。支付和签署的具体 Gateway TypeScript 接口由 API 任务先定义，主控集成时适配接口，不以 placeholder success 代替第三方能力。
