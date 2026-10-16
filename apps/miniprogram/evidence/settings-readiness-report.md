# 设置页实名完成状态与查询隔离

2026-10-16。主控报告真实供应商实名和证书已就绪，但设置页未明确显示“已完成实名核验”并仍出现身份表单。该生产结果由主控确认；本切片未调用生产或供应商，不重新提交实名。

## 修正

- 仅当前服务端readiness.realNameStatus严格等于VERIFIED时显示“已完成实名核验”；签署证书另按certBound与readyForSigning显示“已就绪”或“尚待核验”。不因返回、微信页面消息或本地点击设成功。
- 已VERIFIED隐藏姓名/身份证/独立同意/再次办理按钮，清理输入；handler也拒绝旧事件再次提交。保留主动“核验实名与证书状态”。未实名保留现有默认未选独立同意与三要素路径/刷脸未配置提示，未改变接口或认证强度。
- onShow仍仅GET已有状态，不自动供应商查询/证书申请。整页异步回读绑定customer、当前token、页面generation及loadRevision；主动查询增加identityRevision与lease。较早GET成功/失败不能覆盖较新POST结果；主动查询在途的onShow不再发可能陈旧的readiness GET。旧会话回包/finally不清新操作，unload令所有回包失效。

## 验证

新增8项行为测试，均先观察失败再修绿：实名/证书独立、已实名拒重复提交、旧GET迟到、主动查询中onShow、切账号/同账号换token/退出、unload、旧整页profile回包、旧GET错误。最新完整client184/184、check通过、build96文件/17WXML18WXSS；Mock109文件×2副本SHA零差异。

`node scripts/verify-settings-readiness-layout.cjs`：5种实际WXML编译渲染状态，390×844、5PNG、零溢出/JS异常/外部请求。两张已目视：

- [VERIFIED + 证书就绪](settings-readiness-layout/settings-verified-certificate-ready.png)
- [VERIFIED + 证书尚待核验](settings-readiness-layout/settings-verified-certificate-pending.png)

两者均无姓名/证件输入或再次办理按钮，保留主动查询；另含实名处理中、功能未启用、已实名后的查询错误。详见[report.json](settings-readiness-layout/report.json)。

后台负责人独立只读复核当前源码、重跑8/8，并补充A查询在途→切B/onShow→B查询在途→A成功与finally→B成功的纯内存交错：旧A不回显、不清B busy，B正常完成；无未关闭P1/P2。

改动仅settings JS/WXML、新行为测试、离线版面脚本及本证据；未改API、原生签署/face配置、法务正文、B3购买业务、reference或冻结发布副本。未做真实渠道/原生SDK/二维码/预览/上传。主控后续统一封存与发布。
