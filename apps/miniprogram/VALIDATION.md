验证证据见 ../../docs/evidence/miniapp-verification.md。本包45项测试通过；原样副本28项基线通过；生产源码包85文件，wcc16 WXML/wcsc17 WXSS。真实微信开发工具SDK只读18路由，18原生page根节点、0JS异常、13成功截图/5截图超时。旧合法域名阻断保留；主控配置后刷新本项目缓存，effectiveUrlCheck=true，原生health/vehicles/五种公开协议7/7 HTTP200，首页/空目录/三个常规协议5页无错误、5PNG成功、0JS异常，见evidence/devtools/after-domain-config-rendered。未做鉴权上传/下载、物理真机或真实资金/签章测试。

用户要求账户设置协议改链接后，现有针对性16/16及build通过；仅settings WXML去正文/重复入口，保留title/version、勾选与服务端同意流程。原生SDK实际tap两链接到完整terms/privacy页，v1正文回读正常、0JS异常、4PNG保存，见evidence/devtools/settings-legal-links。未触发登录/短信/同意提交。

2026-10-16 独立1分微信支付验收入口：新增13项adapter/settings行为回归先红后绿，全包58/58通过；生产build为85文件、16 WXML/17 WXSS。9个实际wcc模板离线合成状态，390px浏览器排版截图全部通过，0溢出、0JS异常、0外部请求；见evidence/payment-verification-layout/report.json与payment-verification-report.md。金额固定1分/CNY，匿名或无授权入口隐藏，当前正式协议同意必需，wx成功/取消/失败均查服务端，只有SUCCEEDED表示成功；待确认只查询，手动查询canPay后才允许继续同一验收记录。查询失败清除恢复权限；manualReviewRequired显示服务端人工核对提示，不能推断未扣款。未运行本功能的真实原生SDK、CLI预览、上传、渠道付款或签署；真实验收由主控继续。

2026-10-16 第一阶段人工信用核验：新增18项信用adapter/页面回归先红后绿，全包76/76通过；build仍85文件、16 WXML/17 WXSS。11种实际wcc模板的离线合成显示状态、11PNG、390px零溢出/JS异常/外部请求，见evidence/credit-layout/report.json及credit-review-report.md。独立本申请授权默认未勾选；当前credit-verification说明不可用阻止授权，接受前须更新一般协议同意，拒绝/撤回不受该更新阻断。仅显示运营核验档位、时间、押金规则，不采集score/信用截图。客户确认使用canConfirmFinalPlan与固定信用四字段匹配，后台canFinalize不误用于客户权限。未调用生产API/SDK/预览/上传，也未实现第二阶段里程包及换车台账。
