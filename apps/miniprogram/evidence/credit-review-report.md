# 人工信用核验第一阶段原生报告

2026-10-16，执行已批准的 `docs/superpowers/plans/2026-10-16-credit-and-usage-policy.md` 第一阶段，仅修改本包。信用说明v1、隐私政策v2、申请须知v2由主控管理发布；本轮未查询生产发布状态。

申请详情增加本申请独立授权卡片。默认不勾选，链接现有完整法律页的credit-verification类型。当前正式说明缺失、空正文、类型错误、版本变化或权限不可用时阻止授权；接受授权前须已有当前terms/privacy的服务端同意，页面提供账户设置入口。暂不授权与撤回使用独立权限，不被一般隐私政策更新阻断。当前版本已授权后显示记录，不重复展示接受按钮，避免误重置既有核验；仍可明确改为暂不授权、撤回或联系人工。撤回需原生确认框，使用本申请当前consentId。

适配器调用本人申请的credit-review、credit-consent及withdraw接口，POST只发送批准DTO的字段及幂等键；同一快照暂时失败重试保留键。信用同意没有使用登录checkbox、一般consents或后台伪造记录。页面及适配器均没有精确分数、信用截图、自由证据或审核人输入；响应白名单仅保留需要展示的档位、核验时间和相关授权标识，过滤审核人及额外信用数据。

五档展示为750分及以上、700—749分、650—699分、低于650分、无法核验。0/1/2个月订阅费规则来自服务端有效档位及ruleVersion；不匹配的倍率直接报错，不显示为有效押金依据。低分或无法核验显示转人工处理，不假称正式方案可生成。核验时间显示北京时间。已结束申请标为历史核验，不暗示一定已成交；已有合同金额及必要历史凭据不被前端改写。

授权、拒绝、撤回后同时重新读取申请和信用状态，清空信用同意及最终方案确认checkbox；409和未知写入失败也回读，不保留旧确认。信用接口读取失败独立显示错误，申请仍可只读，并可联系公开客服电话。客户最终确认要求canConfirmFinalPlan，且finalPlan的creditVerificationId、creditRuleVersion、creditBand、creditRevision与当前信用状态相符。后台canFinalize仅表示后台出具动作，已与API人员澄清并添加客户正向确认测试，避免误拦所有客户。

验证记录：

- `tests/credit-review.test.cjs`新增18项，已观察缺失方法、旧方案误确认、客户权限误用、历史状态误标、重复授权和错误押金倍率等红例，再实现绿例。
- `node --test apps/miniprogram/tests/*.test.cjs`：76/76通过，包括上一轮支付验收13项。
- `node apps/miniprogram/scripts/build.cjs`：85文件，wcc16 WXML、wcsc17 WXSS通过；生成本包 `.artifacts/production`。主控先前冻结的支付发布目录不受影响。
- `node apps/miniprogram/scripts/verify-credit-layout.cjs`：实际wcc模板+明确离线合成数据，11状态、11PNG、390×844视口、0横向溢出、0JS异常、0外部请求；检查默认未勾选、隐私更新时可拒绝、无score输入、五档和历史状态。证据在 `credit-layout/report.json`，属于浏览器排版验证，不能称为真机或真实授权核验。
- 原Mock manifest核验109文件、两副本、0差异；原15页WXSS未改。

改动实现为 `src/services/api.js`、`src/pages/application-detail/index.js`/`index.wxml`、`src/pages/legal/index.js`；既有customer-pages夹具增加真实契约的信用状态和最终方案四个信用快照字段。新增测试、排版脚本及证据不进入生产源码包。

没有连接生产API、运行SDK/CLI、创建真实授权或核验、生成预览、上传、支付或签章。尚未验收生产发布文案、新API部署及物理真机授权流程；由主控继续。第二阶段权益购买、里程包、换车台账和退订结算未在本轮实现。
