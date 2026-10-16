# 服务号 H5 独立签约入口：只读审计与最小设计

审计日期：2026-10-16（北京时间）。旧来源 `D:/Projects/auto-subscription-platform`，读取时 HEAD `06f60bc6`；新系统 `D:/wechat-miniapp-sub`。仅阅读源码与配置示例，未读取密钥值、客户数据或运行时环境，未连接旧库、测试库或生产，未修改旧代码、公众号菜单及生产配置。B1 产品源码保持冻结。本文件为设计，未实施 H5。

## 结论与已确认选择

技术上可以在现有 `https://app.subauto.keybox.cloud/miniapp-sign/` 增加独立 H5 及专属 API 反代，不进入旧数据库、不沿用旧客户会话。主控已选定：新库已有客户手机号短信登录、独立 8 小时 HttpOnly Cookie 与 CSRF、H5 完成实名及签署，签后回小程序同步。小程序只提供无秘密固定入口或 kind/id；不传 Bearer、手机号、OpenID 或客户 JWT。无需为第一版引入一次性登录票。

旧 `/portal/*` 保持原样；不能把新入口指向旧合同详情、旧 OAuth、旧短信登录或旧模拟签署页。本仓库只提供部分 Nginx 示例，没有 `app.subauto.keybox.cloud` 当前生产虚拟主机配置，故“可新增”是架构可行性结论，不是对生产代理、服务号控制台设置或真实终端可用性的验收。部署前由主控核查实际 location 优先级、已有缓存/重写及域名设置。

## 旧系统源码证据

下列路径均以 `D:/Projects/auto-subscription-platform/` 为根；行号为本次读取时的位置。

| 源码 | 事实及影响 |
| --- | --- |
| `scripts/wechat-menu.mjs:7,54-103` | 默认菜单域名为 app.subauto；菜单到 `/portal/catalog`、`/portal/applications`、`/portal/orders`、账单、权益及服务请求，没有独立新平台签约路径。脚本会外部写菜单，本次没有执行。 |
| `docs/wechat-official-account-setup.md:9-33` | 记录服务号 OAuth 域名与上述菜单计划；是设置要求与推荐方案，不能证明线上已配置。 |
| `apps/web/src/app/portal/orders/[id]/page.tsx:56,259` | 未登录回旧 `/portal/login`，订单详情跳旧合同详情。源码层入口为“服务号菜单→我的订单→订单详情→合同”。 |
| `apps/web/src/app/portal/login/page.tsx:62-83` | H5 实际以手机验证码调用旧 `/portal/auth/request-code`、`/portal/auth/login`，成功后跳回原页面。 |
| `apps/api/src/portal/portal-auth.service.ts:116-169,176-184,213-264` | 校验并消费旧验证码，按手机号查/建旧 CustomerAccount/Customer，签发旧客户 JWT；每次鉴权再查旧 CustomerAccount。直接复用会访问旧业务库。 |
| `apps/api/src/portal/portal-auth.controller.ts:25-32`；`portal-auth.guard.ts:18-53` | 旧登录设置 Cookie，HttpOnly、SameSite=Lax、生产 Secure；Guard 优先 Cookie、其次 Bearer，交给旧认证服务。Cookie 默认名见 `portal-auth.service.ts:28`，不能作为新平台身份。源码未指定 Domain，实际 Cookie 所属主机取决于旧 API 的部署域名。 |
| `apps/web/src/lib/portal-api.ts:8,26-28` | 旧前端根据 NEXT_PUBLIC_API_BASE_URL 请求旧 API，credentials=include；不能仅复制页面而不替换客户端及全部路由。 |
| `apps/api/src/portal/portal-wechat.controller.ts:9-35`；`wechat/wechat-oauth.service.ts:22-61` | oauth-url 需先通过旧客户 Guard。state 绑定旧 customerAccountId/customerId；callback 换取服务号身份后更新旧 customerAccount.wechatOpenId/UnionId。因此这是旧登录后的微信绑定，不是通用 H5 登录。 |
| `apps/web/src/app/portal/payment-orders/[id]/page.tsx:86-87` | 旧支付缺微信绑定时跳 OAuth，进一步印证 OAuth 服务于旧账户绑定/支付。新签约中心无需调用它。 |
| `apps/web/src/app/portal/contracts/[id]/page.tsx:64,108,142-149,174-181` | 真实签约入口在合同详情：读旧合同、旧登录守门、POST `/portal/contracts/:id/signing/start`，真实结果用 window.location.assign(signUrl) 跳供应商；实名同样为外链。 |
| `apps/api/src/portal/portal-contract.controller.ts:11-35`；`esign/esign.service.ts:915-968,3422-3426` | 服务端按旧客户归属查旧合同，恢复/获取旧签署任务链接；不能向其传新合同 ID。 |
| `apps/web/src/lib/portal-handover-review-view-model.ts:293-320`；`apps/web/src/app/portal/handover-reviews/[id]/page.tsx:204-227` | 交车交接会分流到旧 handover-reviews 独立事实复核与签署，旧流程并非单一通用合同页。 |
| `apps/web/src/app/portal/contracts/[id]/sign/page.tsx:18,67,109` | `/sign` 路由明确是 PortalMockSignPage，调用 mock-sign；禁止当作新真实签约入口。 |
| `apps/web/next.config.ts:3-7` | Next standalone；未声明新独立 prefix rewrite。`nginx/production-subauto.example.conf:7,20-21,36,50-51` 仅给 admin/api 示例；`nginx/staging-app-wechat-oauth.example.conf:2-3` 只有 staging 精确旧 OAuth callback 代理，不能推定实际 app 生产路由。 |

## 新系统可复用能力与不可混用边界

下列路径以 `D:/wechat-miniapp-sub/` 为根。

| 源码 | 已有能力 / 接入要求 |
| --- | --- |
| `apps/api/src/auth/access.ts:43-50` | 新客户 Bearer 通过新库 CustomerSession 哈希查验，旧 Cookie/JWT 当前不被接受。新 H5 Cookie 必须单独鉴权，不回退旧凭据。 |
| `apps/api/src/auth/auth.controller.ts:30-45` | 新短信登录已具身份验证和当前 terms/privacy 同意，但通用 login 会 upsert 客户。H5 第一版须另设“仅已有客户”登录，未知手机号拒绝且不新建客户；不能直接套用现接口行为。 |
| `apps/api/src/integrations/identity.ts:10,23-38,40-69` | 新 identity 使用小程序 AppID 的 code2session/手机号授权，短信验证码在新库限流、过期、消费。服务号 OAuth code 不是小程序 loginCode。服务号身份即使将来接入也须独立字段/身份类型，不能覆盖用于小程序支付的新 Customer.openId。 |
| `apps/api/src/orders/signatures.ts:9-32` | 主合同 sign/sign-status 按新客户归属、订单状态及文档哈希守门；kind=SUBSCRIPTION，补充协议明确拒绝走此通道。 |
| `apps/api/src/operations/workflows.ts:52-55,57-73` | 交接事实确认/异议、独立 sign/sign-status 已存在；签约 H5 不能跳过客户事实确认及证据阅读。未完成前引导回小程序处理，或者完整实现同等确认页面。 |
| `apps/api/src/order-changes/controller.ts:17-20`；`order-changes/signing.ts:12-17` | AMENDMENT 从 changeId 的专用 sign/sync 进入，带 revision/idempotencyKey，使用当前已确认报价和独立 AMENDMENT 合同。H5 必须保持这个业务 ID 与主合同 ID 的区别。 |
| `apps/api/src/esign/esign.controller.ts:15-18` | readiness/register/verify/refresh 可复用；真实姓名/证件输入仅发新 API，不能使用旧系统实名结果替代。 |
| `apps/api/src/esign/fadada/fadada-esign.provider.ts:22,45`；`esign/esign.settings.ts:9` | 签署 notify/return 当前校验 mini-api 域，默认返回新 API 静态页。切换 H5 return 不能只改环境值：需主控批准精确返回地址并相应修改验证，或继续用 mini-api 固定桥转到 H5。可信通知仍保留新 API。 |
| `apps/api/src/esign/esign.controller.ts:55-61`；`orders/signature.service.ts:14-20,31-34` | 服务端可信回调/查询及归档后才推进已签；当前公开 return 只有“返回小程序查询”说明。回跳 URL 不能证明签署成功。AMENDMENT 回调只推进其资金阶段，不冒充主合同完成。 |
| `apps/api/src/files/files.ts:32-35` | 合同/交接文件按新客户归属授权，可通过 H5 受控下载适配；不能变成公开 URL 或绕过归属。 |
| `apps/api/src/app.ts:47-49` | 全局 `/api`，CORS 当前来自 ADMIN_ORIGIN；同 prefix 反代可避免为 H5盲目放宽跨域，也不应把 H5 混入后台允许来源与后台会话。 |

## 主控选定方案的最小路由与 DTO 建议

以下为待 API 同事定稿的设计建议，非既有接口声明。浏览器统一请求 `/miniapp-sign/api/*`；主控反代到新 API 专属命名空间（建议 `/api/h5/*`），不能落到旧 `/api/portal/*`。部署一个独立静态产物，资源路径均带 `/miniapp-sign/`，与旧 Next 产物分离。

1. `POST auth/sms-request {mobile}`：仅已有客户可登录，限流与短信挑战仍用新库；对外采用避免账户枚举的统一响应语义，未知手机号不发码、不建客户。发送失败准确展示，不用测试验证码回退。
2. `POST auth/login {mobile,code,consents:[{documentId,version}]}`：校验新库验证码、当前协议；建立独立 8h H5 会话，返回最少客户摘要、expiresAt、csrfToken，不返回客户 Bearer。`GET auth/me` 返回相同安全会话信息；`POST auth/logout` 需 CSRF，撤销且清 Cookie。
3. `GET signing-records`：分页列当前登录客户自己的主合同/交接/延期补充协议，建议统一 `{kind,id,title,status,statusText,canSign,canSync,blockers,updatedAt}`；`id` 为该 kind 的业务 ID。不能枚举其他客户，也不返回供应商身份、签署外链或证件资料。
4. `GET signing-records/:kind/:id`：返回可展示正文/证据、文档 hash/版本、签署/实名准备状态及服务器权威能力。主合同 id=contractId；HANDOVER id=handoverId；AMENDMENT id=changeId，另只读 contract.id。kind 仅三种白名单。固定入口可带 kind/id 作为导航提示，仍重新按会话校验归属，不作为认证。
5. `GET esign/readiness`；`POST esign/{register,verify,refresh}`：verify 复用严格 `{name,idCardNo}`。仅客户主动点按才发起注册/认证/签署，初始化加载不执行外部操作。证件不进 URL、日志、本地持久化或埋点。
6. `POST signing-records/:kind/:id/sign` / `sync`：映射各已有服务，保留版本、稳定幂等键、租约、两人用印复核、hash 和真实状态校验。AMENDMENT 参数仍 revision/idempotencyKey，不能自行省略。签署响应外链由新 API 提供；前端只允许批准的 HTTPS 供应商入口。sync 返回真实业务状态，未知不假成功、不重建新任务。
7. `GET files/:id`：独立会话鉴权，转既有文件归属检查，禁止任意上游地址代理。文件不可通过接收者篡改路径访问其他客户。
8. `GET` 当前公开法律文案，供登录勾选：返回当前真实已发布版本，不代勾、不复制过期旧平台文案。

所有 Cookie 写动作均由新 H5 鉴权层校验 Origin/CSRF；不能因前缀改写而绕过既有 customer ownership、consent、版本或签署守门。直接调用底层服务或受控适配既有 controller 均可，避免让客户端提供任意 customerId、upstream URL 或后台权限。

## 最小页面与返回操作

入口 `/miniapp-sign/`：标明独立纯电主义签约中心；未登录到新短信登录，已登录列本人可处理记录。空态准确显示暂无签署事项；错误不回退旧 portal。导航参数被篡改、类型无效、会话失效分别准确处理。

详情：显示对应类型、全文/文件、当前版本及确认事实，展示未实名/未绑定证书/运营尚未完成用印复核/已过期等阻断。客户点“前往签署”后才发 sign，再以顶层 H5 外链跳法大大，完全不依赖小程序 web-view 域名。主合同、交接、AMENDMENT 三类分别调用原业务守门；不能在 H5 新造“已确认方案”、绕过交接异议、默认接受条款或使用后台身份代签。

返回页 `/miniapp-sign/return/`：无 query“success”判定；登录仍有效时客户点击“查询签署状态”调用本人的 sync，展示处理中/已签/已拒绝/过期/查询暂不可用。若没有可靠记录上下文，回本人签约中心选择；不把无认证 taskId 当查询权限。8h 会话已过期则重新登录，再查本人记录，不因供应商回跳恢复旧会话。

提供清楚的操作说明：“返回微信中的小程序，在原签约页面点击同步状态”。小程序同步继续走原可信 API。可复制固定小程序操作指引，但第一版不承诺自动唤起能力；自动返回/服务号打开小程序的 SDK 或链接能力若后续要求，须另做官方能力与真机验证。无需改旧公众号菜单：本次由小程序提供固定 H5 入口，服务号中打开该独立 URL；将来菜单新增由主控单独安排。

## 代理、会话及数据边界

- Nginx 为 `/miniapp-sign/` 静态页和 `/miniapp-sign/api/` 新服务设置优先独立 location；API 错误不能 fallback HTML，静态 SPA fallback 不能流入旧 Next；旧 `/portal/*` 和旧 `/api/portal/*` 路由不改。不得把新 H5 API prefix 代理成可选任意地址的通用代理。
- 独立进程/配置只连接新库；不挂载旧 Prisma/旧 DATABASE_URL/旧文件卷，不复制旧客户、旧验证码、旧 session、旧法大大合同任务或旧归档。本次没有核查线上连接串，不以源码代替上线配置审计。
- 建议 Cookie 名 `independent_h5_session`，Secure、HttpOnly、SameSite=Lax、host-only、Path=`/miniapp-sign/`，8h 到期；Cookie 值仅随机凭据，服务端存 hash。Lax 用于外部签署顶层返回；写操作同时要求固定允许 Origin 和匹配 CSRF。Cookie 名/密钥/会话表与旧 portal 及后台独立，logout 只撤销新 H5。
- 专属代理不转发旧客户 Cookie/JWT 或任意客户端 Authorization 作为 H5 身份。上游只读自身 H5 Cookie；不能按旧会话签名、手机 claim、OpenID 或 URL customerId 自动互认。新 H5 仅查新库已有客户，短信验证后按新库手机号识别本人。
- 日志脱敏：禁止验证码、Cookie、CSRF、Bearer、签署 URL、OAuth code、证件、完整手机号/客户信息；响应与文件 private/no-store，入口和回跳 Referrer-Policy=no-referrer，不接入第三方追踪脚本。CSP 约束自有静态资源与必须的服务，外链跳转另做目标白名单，不能宽泛 `*`。
- **路径隔离不等于浏览器同源隔离。** 同 app 主机下，旧 portal 的脚本与新 H5 共享 origin；Cookie Path 不能抵御同源 XSS。此方案可实现新旧 DB/业务会话独立，但不能声称具有独立子域同等的浏览器安全边界。主控部署前核查旧服务 worker/root scope、旧页面可注入内容及 CSP；当前源码检索未见 serviceWorker 注册，但未查询生产，不能据此断言没有。若要求强浏览器隔离，应另用独立主机，而非靠 Path。

## 开工与验收边界

API 同事先给确定路由、Cookie/CSRF 与 safe DTO；前端只在分配的新目录实施，B1 保持冻结。主控负责新独立 Nginx location、产物及返回地址配置。任何真实短信、实名、供应商签署需主控再次明确测试对象及交易范围；本次设计审计没有触发。

最低验证：旧 portal 不受影响；旧 Cookie/Bearer 在新 H5 401；未知手机号不建客户；本人三类签约可列读、他人 id 404；缺协议/CSRF/来源/过期会话被拒绝；未实名、未两人复核及未知任务不误签；AMENDMENT不走主合同通道；相同请求恢复同任务；回跳伪造 success 不改变状态；仅可信查询/回调+归档推进已签；返回后小程序同步同新库状态；手机窄屏与外链往返保留登录、失败可重试；日志与截图不含秘密。
