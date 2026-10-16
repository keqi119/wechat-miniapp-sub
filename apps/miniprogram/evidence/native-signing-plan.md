# 小程序内实名与签约恢复计划

2026-10-16。主控转达用户选择恢复web-view原生主流程，确认textapi17.fadada.com与realnameverify16.fadada.com域名校验完成；工程设计已获主控通过。仅在本隔离工作树apps/miniprogram实施，基线d96ac7a，无B2/017，根B2源码与成果冻结不覆盖。API负责人独占同树apps/api与依赖安装，主控合并处理交界。

公开契约按API方案：GET public/signing-config 返回mode=MINIAPP_WEBVIEW、enabled、signProviderConfigured、精确providerHosts及固定returnUrl=https://mini-api.subauto.keybox.cloud/api/public/esign-return。fallback只作为兼容配置，不在原生自动打开。关闭/缺配置在任何create前拒绝；状态查询保持可用。

实名仅用户明确点击：单独current privacy选择默认未勾选，POST register/verify（name,idCardNo,consent:{accepted:true,documentId,version}）；主合同/交接sign及AMENDMENT revision/key沿既有服务；外链由API精确校验后响应，原生再校验一次。初始H5仅在内存保留，storage仅不透明业务kind/id，不保存URL、token、身份证或四参数；不打敏感日志。未知kind不降级主合同。

签页恢复web-view/reloadPage与可信onShow查询，不以message、导航成功、faceResult或return URL参数判定VERIFIED/SIGNED。实名自动回查只GETreadiness，可能申请证书的refresh由用户另外点击；主/交接/signature sync保留归属、版本、文档/PDF/用印审批。关闭创建仍可查询历史结果，异常清除屏幕伪成功。

官方5.1.2明确实名is_mini_program=3、手动签open_environment=4及pagesFace/pages/middle/middle，需API同步供应商参数。本机官方DEMO四参数动态注入，但生产不能原样信任：单次解码、长度/格式边界、当前已认证flow及TTL、精确AppID/path/callback防改、scene1038与referrerInfo.appId、用户点击navigateToMiniProgram。专属域名按5.1.3不允许显式端口（含443），不能替换旧域或URL整串replace。

刷脸缺exact AppID/path/callback绑定时中间页fail-closed，不猜值；已知域名的实名/签署web-view与状态页继续实现。建议API可选提供server可信bridge:{flowId,expiresAt,appId,path,callbackUrl}；未提供时明确刷脸桥接尚未配置，拒接受任意路由参数。此字段仍待API最终确认，不把客户端传来的bridge当server授权。其他页不受此具体缺口阻断。

TDD顺序：纯URL/config/中间四参数与可信flow/返回校验→真实adapter仅显式点击与内存任务→实名独立同意表单/状态页→官方路径中间页与返回恢复→针对错误、关闭、缺桥接配置、三kind、过期/重放/取消/缺能力回归→全包/编译/离线actual-wcc截图/Mock SHA。没有真实API/数据库/SDK、实名/签署/短信/支付、二维码/预览或上传。

最终决策：主控核读官方verified_way=1三要素补充，通过时不需刷脸；不统一禁实名/签署。未知Face AppID/path仅关闭实际刷脸跳转分支。修后验证与独立审查见native-signing-report.md。
