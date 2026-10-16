# 技术验收本人入口实施记录

基线fdaff1a，2026-10-16。范围仅apps/miniprogram，按已批准technical-signing-verification计划Task3施工；不提交，待主控Git窗口。API exact契约发布后才实现业务请求。

1. 独立本人列表/详情与账户设置入口，不借用商业订单。全文与正文/PDF摘要明确展示；文件阅读确认与必要数据单独同意默认不选。缺正式文案、当前版本、能力或同意不提交。
2. 独立technical-acceptance kind复用现有原生域名/会话/TTL/短URL仅内存策略；正式签署关闭时仅依独立技术开关，不隐含开放合同、交接或变更。onShow/返回仅安全状态读取，需要渠道动作的核验明确点击。
3. confirm/sign/stop遵循服务端revision及稳定幂等key；每await绑定customer/token/generation；停止后清除本流程内存入口并禁止新签署，仍可读取可信迟到结果；只有双方签署且signedFile归档表示完成本份签署，不称整体系统通过。
4. 文件只从fresh本人详情白名单取得source/signed id，经鉴权下载；下载途中换会话不打开。默认不保存短URL/正文/身份到storage，不采集已核验身份证或新增信用/车辆资料。
5. 先红行为回归，后最小实现；完整client/check/build/Mock109×2哈希、actual-wcc离线图及API提供独立本地HTTP夹具。禁止真实渠道/旧库/生产/SDK/预览上传。报告区分纯内存、离线和真实本地HTTP。

Ruling：共享sign页对本kind的onShow/webview消息只做纯DB状态GET；主动核验按钮才调用API明确核验路由。原因是既有provider query可能执行企业用印，不能由页面生命周期替本人发起。正式接口由API负责人确认。

契约已固定：GET sign-status纯DB、POST sync才主动核验；enabled仅实际签署开关，按服务端canConfirm可先阅读确认。document.sourcePdfHash是真实PDF SHA，documentHash为业务绑定摘要，均明确展示。一般consentRequirementsMet=false或对应冲突引导现有settings明确更新，不新增授权系统、不重复实名。

执行记录：32技术行为测试/31实际红→绿；完整216/216、check/build101源文件/18WXML19WXSS、Mock109×2零差异；15actual-wcc版面通过。早期HTTP登录等待会话已按重启要求结束。稳定主控夹具后观察13请求一般consent升级/本人confirm节点，真实DTO捕获planHash前缀差异并TDD修复；原记录恢复段16检查/24请求通过（双审后sign、纯GET、主动sync归档、本人PDF/跨归属拒绝、本人stop保留事实），不重建或重确认。已关闭交叉审阅后台旧409盖B详情与原生操作期间onShow旧GET覆POST的P2边界。未git。
