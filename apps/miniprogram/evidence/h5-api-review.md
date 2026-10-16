# H5签约API独立只读审查

2026-10-16。审查当前 `apps/api/src/h5-sign/*`、公共Access、实名readiness/回调、原三类签署适配、企业签章策略、文件归档和相应既有测试；并只读核对新增Nginx前缀。未修改API/admin/配置、连接任何数据库、运行API测试、请求业务HTTP或供应商。原生功能冻结，最后只做已授权的客户指引文案收敛。

结论：两处明确问题已直接报告API负责人与主控，均已复读修复源码及对应回归定义；目前未发现新的明确发布阻断。这是源码审查结论，不代表生产路由配置、真实SMS、法大大实名/双签/下载归档或移动微信往返已经实测。

## 发现与修复复核

1. **P1，已修复：H5关闭时旧小程序副作用入口复活。** 初版Access只在 `h5Enabled()` 为true时拒绝旧Bearer实名register/verify/refresh及主合同、交接、AMENDMENT的sign。公开mode固定为SERVICE_ACCOUNT_H5，因此关闭H5不应隐式恢复旧签署方式，否则旧版本可绕过新H5独立实名同意与入口。现Access永久拒绝这六类旧POST，独立于开关true/false/缺省；也处理尾斜杠和内层路由大小写。保留readiness、原业务确认及可信状态查询。新测试明确三种开关状态均409 `H5_SIGNING_REQUIRED`，provider调用计数不变；本审查复读测试，没有自行执行。
2. **P2，已修复：SMS请求状态差异暴露已注册手机号。** 初版未知手机号固定201，而已有手机号在真实gateway限流/不可用时429/503，重复请求可根据响应区别注册情况。现未知、已发、被限流与供应商不可用均201 `{accepted:true}`；已注册账号仍走真实gateway限流，失败仅审计白名单errorCode，未知账号不发SMS、不建客户。新测试比较四种响应并核对安全审计无手机号。此修复统一响应形状/状态，不声称实现恒定时间认证。

## 已见源码的关键边界

| 范围 | 核对结果 |
| --- | --- |
| 独立认证 | `h5-sign/access.ts`只接受独立 `h5_signing_session` Cookie，校验哈希会话与8小时期限；不复用miniapp Bearer、后台Cookie或旧portal身份。`auth.controller.ts`只允许新库既有手机号SMS登录，不创建新客户，不更改openid。 |
| Cookie与CSRF | Cookie为HttpOnly/Secure/SameSite=Lax，path `/miniapp-sign/`；每个H5写请求要求固定Origin，登录后还要求会话CSRF。`deploy/nginx-signing-h5.conf`将浏览器 `/miniapp-sign/api/` 映射 `/api/h5-sign/`，与Cookie路径一致；SMS/login有独立Nginx限流。这里只核对文件，未验部署实效。 |
| 开关关闭 | 配置/当前法务GET可读取；H5其余路由在缺flag或false时503。旧miniapp六类副作用永久409，不回退旧方式。原生也同时验证固定mode、完整entryUrl与enabled，再允许用户点击复制。 |
| 当前协议与实名独立同意 | H5登录保存当前terms/privacy同意；register/verify/refresh再次检查当前同意。verify另强制独立 `{accepted:true,documentId,version}` 绑定当前privacy，供应商调用前审计版本/hash；未知多余字段拒绝。不把登录同意当作实名处理选择，也不在审计写姓名/证件。 |
| 真实readiness | `fadada-safety.ts::accountReadiness`要求已注册providerCustomerId、已验证identityCiphertext的hash/attempt、供应商QUERY或CALLBACK来源、证书绑定、最近核查且无在途核验租约；不以手机号登录或客户端status认定就绪。原生只GET readiness；H5显式refresh可能申请证书，属于用户触发的写动作。 |
| 本人记录及kind | H5列表/详情均按会话customerId。主合同查kind=SUBSCRIPTION；交接排除DRAFT；AMENDMENT从本人OrderChange的activeQuote定位合同，kind枚举不可任意降级。客户sign/sync再进入原服务的归属和状态检查。未发现跨客户记录或用changeID作为合同ID签署的路径。 |
| AMENDMENT版本 | H5强制提交最新OrderChange.revision；原DelaySigning再次核对归属/revision，sign在订单锁内复查AWAITING_SIGNATURE。主合同send/sync显式拒AMENDMENT；补充协议仍走原DelaySigning，不复用主合同推进路径。 |
| 正式文档与用印 | H5预检查需要真实PDF、同客户hash匹配的当前批准记录、不同申请人/批准人、批准时间与未过期；已有task只读其绑定approval，不能因后来另有批准跳过原授权。真正gateway.create及首次企业盖章还调用policies.approved，复查当前实名、策略、印章、人员授权、planHash、业务状态和原PDF完整性；H5 canSign只是预检查，不取代这些守门。 |
| 任务恢复 | kind/resourceId/documentHash定位持久任务，核对客户及已有providerTaskId；准备租约避免并发重复发起。H5 sync沿原服务recover/query，不首次create；网页返回或URL中的status参数不会直接设置SIGNED。 |
| 回调与双签 | Fadada回调先验摘要并绑定transaction/envelope，再服务器query；query每次核对provider contract/customer/transaction。客户单签仅PENDING，企业状态不明不重复盖章；企业执行需有效双人授权及sealRequestedAt。双方可信SIGNED后下载PDF归档才返回SIGNED。回调按task.kind区分交接/合同，AMENDMENT结算另核对当前activeQuote和变更状态，只推进AWAITING_FINANCE，主订单推进仅SUBSCRIPTION。 |
| 文件归属与完整性 | H5文件须同客户PDF，并关联本人的SIGNED合同/交接、已批准source或已上传task；普通资料PDF及其他客户文件不可借此读取。writer.readVerified再次验证路径、大小、PDF头和SHA256；返回source/signed ID也按同客户及类型过滤。 |
| 固定返回和供应商跳转 | H5返回固定 `/miniapp-sign/return/`；approvedReturnUrl不接受任意URL或携带成功参数的返回。供应商redirect必须HTTPS、无userinfo、443端口及精确hostname allowlist；不接受后缀冒充、任意next或javascript。响应no-store/no-referrer，短链接不作为miniapp参数。 |
| 原生恢复 | 原生实名仅GETreadiness，主/交接GET各自sign-status，AMENDMENT freshGET后以最新revision POSTsync。缺归档、403/409/网络错误不会保持成功状态。三个业务事实确认与已签PDF查看继续存在；实名/签署发起全部进入本地说明及固定公开入口复制。 |

## 证据范围

已复读 `apps/api/test/h5-signing.test.ts` 的15个测试定义，涵盖独立认证、Origin/CSRF/期限、未知账号、独立实名同意、三kind归属及委托、受控redirect、PDF、伪成功参数、绑定旧审批及本次两处修复。其fixture使用假SMS/gateway/readiness及合成PDF，不可作为真实渠道验收。

API负责人报告完整157/157通过，最后受影响26/26（11原HTTP+15H5）及build通过；这是负责人的执行结果，本审查未运行或冒认为自己的结果。本人执行的原生验证见 `h5-signing-report.md`：此前全124项，最终文案后专项12/12与build、13种离线wcc截图通过。未调用真实剪贴板、SDK、SMS、支付、实名、签署，未生成二维码或预览/上传。

实际启用仍由主控核对固定host新前缀、H5安全头/代理和供应商允许返回地址、公开配置及真实账户授权范围。本文不声称服务号菜单已配置、自动唤起小程序、真实双签已完成，也不建议关闭URL检查或放宽域名来绕过要求。
