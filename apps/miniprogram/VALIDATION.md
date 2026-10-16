验证证据见 ../../docs/evidence/miniapp-verification.md。本包45项测试通过；原样副本28项基线通过；生产源码包85文件，wcc16 WXML/wcsc17 WXSS。真实微信开发工具SDK只读18路由，18原生page根节点、0JS异常、13成功截图/5截图超时。旧合法域名阻断保留；主控配置后刷新本项目缓存，effectiveUrlCheck=true，原生health/vehicles/五种公开协议7/7 HTTP200，首页/空目录/三个常规协议5页无错误、5PNG成功、0JS异常，见evidence/devtools/after-domain-config-rendered。未做鉴权上传/下载、物理真机或真实资金/签章测试。

用户要求账户设置协议改链接后，现有针对性16/16及build通过；仅settings WXML去正文/重复入口，保留title/version、勾选与服务端同意流程。原生SDK实际tap两链接到完整terms/privacy页，v1正文回读正常、0JS异常、4PNG保存，见evidence/devtools/settings-legal-links。未触发登录/短信/同意提交。

2026-10-16 独立1分微信支付验收入口：新增13项adapter/settings行为回归先红后绿，全包58/58通过；生产build为85文件、16 WXML/17 WXSS。9个实际wcc模板离线合成状态，390px浏览器排版截图全部通过，0溢出、0JS异常、0外部请求；见evidence/payment-verification-layout/report.json与payment-verification-report.md。金额固定1分/CNY，匿名或无授权入口隐藏，当前正式协议同意必需，wx成功/取消/失败均查服务端，只有SUCCEEDED表示成功；待确认只查询，手动查询canPay后才允许继续同一验收记录。查询失败清除恢复权限；manualReviewRequired显示服务端人工核对提示，不能推断未扣款。未运行本功能的真实原生SDK、CLI预览、上传、渠道付款或签署；真实验收由主控继续。

2026-10-16 第一阶段人工信用核验：新增18项信用adapter/页面回归先红后绿，全包76/76通过；build仍85文件、16 WXML/17 WXSS。11种实际wcc模板的离线合成显示状态、11PNG、390px零溢出/JS异常/外部请求，见evidence/credit-layout/report.json及credit-review-report.md。独立本申请授权默认未勾选；当前credit-verification说明不可用阻止授权，接受前须更新一般协议同意，拒绝/撤回不受该更新阻断。仅显示运营核验档位、时间、押金规则，不采集score/信用截图。客户确认使用canConfirmFinalPlan与固定信用四字段匹配，后台canFinalize不误用于客户权限。未调用生产API/SDK/预览/上传，也未实现第二阶段里程包及换车台账。

2026-10-16 第二阶段A月里程/里程包/退订结算：新增14项usage行为回归先红后绿，全包90/90通过；build86文件、16 WXML/17 WXSS，原16页面及15页WXSS不变。11个实际wcc模板离线合成状态、11PNG、390px零溢出/JS异常/外部请求，见evidence/usage-layout/report.json及usage-stage-a-report.md。按服务端订阅月申报实际月界/归还日照片、北京时间时分；缺报不估算，前月未结仍可先收本月真实证据。里程包正式文案缺失禁买，金额固定批准规格，默认未勾选并绑定文案id/version/hash；只创建普通账单，不自动付款或本地加额度。退订结算只读/异议，余额冻结/失效与押金待退金额以服务端为准，无直接结清或自动扣押金。最终方案完整展示固定usagePolicy正文，缺已批准全文或关键规则不一致则不能确认。没有生产API/SDK/预览/上传/真实购买或付款，第二阶段B换车未实现。

A冻结后的授权兼容补丁：追加REFUND_PENDING/REFUNDED包状态及REFUND流水映射，分别明确退款核对中冻结不可消费/已退款不可用/退款收回，金额与余额仍完全取服务端；未知包状态继续报错。新增1项先红后绿，usage15/15、全包91/91；build86文件/16WXML/17WXSS；13状态离线版面13PNG、零溢出/JS异常/外部请求。未增加客户退款写入口或执行真实退款。

A契约视觉核对补丁：交接确认前独立显著展示服务端actualAt对应北京时间及实际交车/还车标签；新事实确认前fresh GET核对actualAt与manifestHash及屏幕展示快照，不向后端传入客户端补造时间。缺失/无效/未来时间禁止新事实确认，已响应历史仍可查看；时间未核对历史不发起新签署。月里程范围标“末日不含”，归还尾月单列归还时刻截止，服务端日期未改。新增2回归，最终全包93/93、build86文件/16WXML/17WXSS，14状态14PNG零溢出/JS异常/外部请求，含handover-server-actual-time.png。

末期边界补充：实际归还日恰等于原endDate时，按account.returnedOn+最后非CANCELLED期识别归还尾期，仍显示“以实际还车时刻截止”，不误标普通“末日不含”。新增1红→绿，最终全包94/94；build86文件/16WXML/17WXSS，14状态14PNG仍零溢出/异常/外部请求；不改DTO日期。

2026-10-16 B1延期交车：新增15项行为回归先红后绿，全包109/109通过；build87文件/16WXML/17WXSS，Mock109文件×2副本0差异。9个actual-wcc离线合成状态、9PNG、390px零溢出/JS异常/外部请求，见evidence/delivery-delay-layout/report.json与delivery-delay-report.md。版本/hash fresh守门、默认未勾选、正式补充全文缺失关闭、拒绝原因、稳定幂等key、终态及409/429/500/网络失败、服务端SIGNED+归档守门。仅复用原签页kind路由；未变更Fadada桥接/域名、冻结A副本或生产，未调用业务API/SDK/预览/上传/真实付款签署。

B1只读安全审查后授权兼容：list summary和详情分离、详情坚持resolved正文，新增3行为回归先红后绿，最终112/112（B1共18）、build87文件/16WXML17WXSS、Mock109×2零差异；11种actual-wcc离线版面11PNG零溢出/异常/外部请求。首次确认期限按服务端quote.expiresAt北京时间展示，过期或无有效时区时间禁confirm；已确认不误阻后续sign/sync。只读API发现与修复进度见evidence/delivery-delay-api-review.md，未运行共享DB/业务HTTP/供应商操作。

2026-10-16 H5签约指引切片：新增12行为回归（首9红→绿），全包124/124，build88文件/16WXML17WXSS、Mock109×2零差异；13actual-wcc离线状态13PNG零溢出/异常/外部请求。实名/三kind仅本地指引+用户复制受公开配置enabled控制的固定链接，无身份信息URL传递、外部webview或任务创建。onShow按kind可信回查，身份GETreadiness不申请证书。evidence/h5-signing-report.md，未用SDK/业务API/真实剪贴板/短信签约/预览上传。
