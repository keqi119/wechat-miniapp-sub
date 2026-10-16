# 独立 0.01 元微信支付验收原生实现

2026-10-16。依据已批准的 `docs/superpowers/plans/2026-10-16-payment-verification.md` 完成原生范围，主控负责生产接口、授权、独立开关、预览与真实付款确认。

账户设置仅为已登录且有本人后台授权记录的客户显示入口，明确说明“微信支付验收 0.01 元，不订阅车辆、不生成租赁合同”。金额不可编辑，只有整数1分与CNY可以启动；每次付款前重新读取本人列表及当前正式用户协议、隐私政策的服务端同意记录。既有租赁付款、报价、合同和业务流程未改变。

`services/api.js` 接通 GET `/customer/payment-verifications`、POST `/:id/pay` 与 POST `/:id/query`。原生付款只由按钮点击触发，微信成功、取消和失败都查询服务端，仅SUCCEEDED显示支付成功。支付凭据仅存在局部变量并传给wx.requestPayment，不进入页面data、storage或日志；页面只接收白名单展示字段。

AUTHORIZED可主动付款；CREATING/PENDING首先查询，手动查询返回canPay=true后显示“继续本次验收（0.01元）”，继续同一授权记录、沿用后端原交易，不自动付款或新建记录。查询失败立即清除恢复权限。SUCCEEDED/CLOSED/FAILED/EXPIRED全部禁止再次付款；409会查询权威状态，403/429/500和无效参数保持失败。manualReviewRequired显示服务端statusMessage及“需人工核对支付结果”；过期未知单不能描述为确定未扣款。busy同时防页面与adapter重入，账户登录/同意操作内的刷新仍能加载授权入口。

验证：

- 新增 `tests/payment-verification.test.cjs` 13项，先观测缺失方法、无SDK错误payload、账户操作busy刷新、未知过期人工提示等红例，再实现通过。
- `node --test apps/miniprogram/tests/*.test.cjs`：58/58通过。
- `node apps/miniprogram/scripts/build.cjs`：85文件；实际wcc16 WXML、wcsc17 WXSS通过，产物 `.artifacts/production`。
- `node apps/miniprogram/scripts/verify-payment-verification-layout.cjs`：9种实际wcc模板的离线合成状态，9PNG，390×844视口，0横向溢出、0JS异常、0外部请求。包括匿名/无授权隐藏、授权付款、协议未同意禁用、待确认只查询、显式同单恢复、查询失败、已支付、未知过期人工核对。证据在 `payment-verification-layout/report.json`；这些是浏览器排版验收，不能称为真实原生或付款成功。
- `node apps/miniprogram/scripts/verify-reference.cjs`：109文件、两副本、0差异；原Mock副本未改。

实现文件为 `src/services/api.js`、`src/pages/settings/index.js`、`src/pages/settings/index.wxml`；原有 `tests/customer-pages.test.cjs` 仅补只读空授权列表fixture。新增测试、离线验证脚本与本证据文件不进入生产源码包。

本轮没有连接真实支付渠道，没有运行本功能的SDK/CLI、生成预览、上传、创建生产授权或调用真实wx.requestPayment。测试在注入的HTTP/原生边界完成；真实1分支付、可信查询/回调、新库记录核对及独立开关收尾仍由主控执行，不能将本报告视为真实资金验收完成。
