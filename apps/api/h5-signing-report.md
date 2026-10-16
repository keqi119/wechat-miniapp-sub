# 独立服务号 H5 签约 API

2026-10-16。本切片只修改新平台 API 与本地开发/测试数据库；没有访问旧业务库、部署、发送真实短信、执行实名或签章。固定入口为 `https://app.subauto.keybox.cloud/miniapp-sign/`，外部 `/miniapp-sign/api/*` 由主控反代到新 API `/api/h5-sign/*`。

## 认证和数据边界

- 迁移 `202610160016_h5_signing_session` 新增独立 `H5SigningSession`，随机凭据仅 hash 入库；有效期 8 小时。Cookie 名 `h5_signing_session`，始终 HttpOnly、Secure、SameSite=Lax、Path=/miniapp-sign/，不设置跨域 Domain。
- H5 路由只认此会话，旧后台 cookie、小程序 Bearer/会话不能认证。所有写请求只接受精确批准 Origin，登录后还必须携带独立 `X-CSRF-Token`；不使用 Host、X-Forwarded-Host 或客户端参数生成返回地址。
- 短信调用既有 IdentityGateway，复用持久限流与验证码一次核销。仅新库已有手机号可登录，不 upsert 客户、不绑定或改变 OpenID。未知号不实际发送；未知号、发送成功、网关冷却/失败均返回中性 201 `{accepted:true}`。已知号失败仍保留网关限流行为及内部错误码审计，不记录手机号/验证码/凭据。不宣称网络耗时恒定；Nginx IP 限流仍可明确返回 429。未知号与错误验证码登录同为 401 LOGIN_UNAVAILABLE。
- 登录需当前 terms/privacy；实名提交另须本次独立 `consent:{accepted:true,documentId,version}`，绑定当前 privacy。缺失或过期在供应商调用前拒绝，`ESIGN_REALNAME_CONSENT` 审计只含文案 id/version/hash、客户及时间，不含姓名证件。
- H5 所有认证响应、资源和 PDF 禁止缓存，返回仅 maskedMobile。姓名和证件只用于显式实名请求，实名原服务仍加密持久化；签署短期跳转 URL 不写本模块审计或会话。

## 接口定稿

下表相对于 `/api/h5-sign`；H5 浏览器使用主控反代后的 `/miniapp-sign/api`。

| 方法/路径 | 请求与返回 |
| --- | --- |
| GET /config | `{mode:'SERVICE_ACCOUNT_H5',entryUrl,enabled,signProviderConfigured}`；另公开 GET `/api/public/signing-config` 同形供小程序 |
| GET /legal | `{documents:[{id,type,version,title,content}]}`，当前已确认发布的 terms/privacy |
| POST /auth/sms/request | `{mobile}` → `{accepted:true}`；页面说明“请求已提交；若未收到，请稍后重试或联系平台”，不承诺送达 |
| POST /auth/login | `{mobile,code,consents:[{documentId,version}]}` → `{customer:{id,maskedMobile},csrfToken,expiresAt}` + Cookie |
| GET /auth/me | 同登录 safe；不返回 bearer token/OpenID/完整手机号 |
| POST /auth/logout | `{}` → `{success:true}`，删除独立会话并清除同 Path Cookie |
| GET /account/readiness | 原安全实名资格状态 |
| POST /account/register | `{}` → 原安全资格状态；用户主动操作 |
| POST /account/verify | `{name,idCardNo,consent:{accepted:true,documentId,version}}` → `{status:'PENDING',redirectUrl}` |
| POST /account/refresh | `{}` → 原安全资格状态；可能完成证书核验/绑定，因此必须是 H5 用户主动操作 |
| GET /records | `{items:[{kind,id,orderId,title,status,createdAt,canSign,canSync,sourceFileId?,signedFileId?}]}`；不含个人正文/供应商任务/原始响应 |
| GET /records/:kind/:id | 上述摘要 + `{documentHash,readiness,blockers:string[],revision?,actualAt?,body?}`；正文仅本人审核后文档 |
| POST /records/:kind/:id/sign | `{revision?:number}`，AMENDMENT 必填当前变更 revision；返回 `{record,redirectUrl?}` |
| POST /records/:kind/:id/sync | 同版本输入，返回可信回读 record，不接受客户声称的签署结果 |
| GET /files/:id | 本人已审批原 PDF 或可信签后归档；实际读取时检查文件 bytes/size/SHA |

kind 为 SUBSCRIPTION、HANDOVER、AMENDMENT；id 分别为主合同 id、交接单 id、订单变更 id。AMENDMENT 内部按当前变更映射合同 id，不能从通用主合同路径误签。字段 `status` 是签署状态，SIGNED 且存在 signedFileId 才有已签归档；未准备/审批不显示可签。文件必须归属本人且关联审批/可信任务或签后记录，不提供普通 profile/identity 上传附件浏览权限。

## 原状态机与配置

H5 通过原 SignaturesController、WorkflowsController、DelaySigning、CustomerESignOnboardingService 复用业务、审批、租约、供应商任务恢复和可信归档流程。原服务只增内部固定 returnUrl 参数，不从 HTTP 请求任意传入。已有任务的详情资格使用其绑定 approvalId，与供应商执行链同源；无任务时按 approvedAt 取审批。

`H5_SIGNING_ENABLED` 默认 false，只控制 H5 入口暂停/开放。新版本永久拒绝旧小程序 `customer/.../sign` 与 `customer/esign/register|verify|refresh` 外部调用为 H5_SIGNING_REQUIRED，包含尾斜杠及大小写变体；true、false、未配置均不会恢复旧通道。保留 GET readiness、可信 sign-status/sync 及只读文件。H5 内部复用不受该路由拦截影响，没有生产/测试兼容绕过开关。原 HTTP 回归唯一旧 503 期望更新为该明确 409。

`H5_SIGNING_PROVIDER_HOSTS` 为精确主机 allowlist，默认空禁止返回跳转；只接受 HTTPS、无 userinfo、默认 443。主控通过旧 H5 只读证据批准 `textapi.fadada.com,realnameverify.fadada.com`，本代理没有打开带凭据旧 URL。生产环境写入由主控负责。返回地址精确允许原 mini-api public/esign-return 或新 H5 `/miniapp-sign/return/`；H5 内部固定使用后者，供应商通知仍指新 mini-api，浏览器 query 参数不作为成功证据。

H5 开关、法大大注册/实名开关、真实 signing 开关独立；本次未更改生产开关。即使入口已开，缺审批/实名/签署功能开关仍不可签。用户批准延期文案的正式发布与企业印章及双人审批配置由主控处理。

## 文件和验证

- 新增 `src/h5-sign/{config,access,auth.controller,account.controller,records.controller,records.service}.ts`、独立模型/迁移及 `test/h5-signing.test.ts`。
- 必要集成：app、Access、ESignGateway 内部 return 参数、三类既有签署入口和 onboarding/provider 返回地址校验；只调整一处 lifecycle 合成 fixture 为实际批准的原返回路径。
- Prisma generate、本地 dev/test migrate 均 exit 0。初次 H5 专项 13/13；后续独立 review 的永久旧路由/规范化和短信中性响应补丁完成后，`pnpm --filter @chundian/api exec tsx --test --test-concurrency=1 test/api.test.ts test/h5-signing.test.ts` 最终 26/26（11 原业务 HTTP + 15 H5），0 skipped，约 26 秒。关键新守门先复现缺失路由、旧版副作用未阻断、账号错误响应差异、实名缺独立同意、暂停恢复旧路径/尾斜杠及短信响应差异，再补实现并验证。
- 专项含独立 Cookie/CSRF/Origin/过期/旧会话隔离，不存在不建号不发送，OpenID 不改，三类本人/跨客户及实际原状态机委托，可信 sync/归档，调用者伪成功参数无效，批准原稿下载与普通附件拒绝，当前 task 审批绑定，HTTPS/host/return 限定，实名独立同意及审计无敏感输入。全部供应商调用使用注入测试替身；不等于真实渠道联调。
- 构建 `pnpm --filter @chundian/api build` exit 0；`git diff --check -- apps/api` 无错误。固定来源 manifest 中 15 个 `adaptation:none` 文件 SHA 均未变化。
- `pnpm --filter @chundian/api test` 完整串行回归 157/157、0 failed/0 skipped，约 132 秒；该全套在最后两项 review 守门补丁之前。之后按主控要求跑上述受影响 26 项及 build，均通过，未伪称补丁后重新跑全套。最后 build exit 0，源码冻结，测试库释放。
