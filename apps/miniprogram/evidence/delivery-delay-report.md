# B1 原生延期交车实现与验证

2026-10-16。依据已批准B1方案及API负责人定稿契约，实施范围为apps/miniprogram；原A1.0.3冻结副本、原Mock、后端、生产配置及发布未修改。只做延期交车，不增加换车、次数购买或客户自主取消结清功能。

复用records/record页面，新增“我的→延期交车方案”、订单详情入口和dashboard.subscription.deliveryDelayChangeId对应入口。专属GET /customer/order-changes及/:id只读取当前客户safe数据；初始revision=0草稿可查看状态，未发布quote始终隐藏。服务端未知状态、种类、日期或非整数/负金额拒绝处理，不回退演示数据。

用车页原卡片固定“用车中”会误导延期等待交车状态，本次改为服务端subscription.statusText，缺值显示待核对。离线真实模板回归先复现旧“用车中”误标，再改为服务端“待交车”通过；不客户端推断已经交付。

正式方案展示固定起止日、保持原月数、每期服务范围与付款日、应付/原期金额/原款净实收/本期沿用/补收/退款及计算依据，另展示资金结算、交接及取消异常安排。新结束日标“含当日”，period.endDate标“末日不含”；只展示服务端日期及金额，不客户端推算订阅月或净实收。正式补充条款document id/type/version/hash/content须齐备且无未填变量，否则关闭客户确认与签署；固定全文完整显示，未把根起草的待批准模板当成可签文案。

本版本阅读checkbox默认未勾选，reload/变更/错误即清除。确认前fresh GET核对OrderChange.revision+commercialHash与当前能力，POST绑定revision/hash/idempotencyKey；同一未知结果重试保留key，busy阻止重复提交。拒绝必须提供原因，仅提交该版本人工处理意见，不退订、不付款、不退款。409/429/500和网络失败保留错误，不声称成功或使用旧权限。

签署仅复用当前受控host校验与pages/sign载体，新增kind=order-change路由；没有实现Fadada刷脸桥接或修改signingHosts/urlCheck。sign仍由客户点击，POST携带当前revision/key。签页查询先fresh详情，再以最新revision POST sync；仅contract.status=SIGNED且存在signedFileId才显示可信完成，缺归档不视为成功。方案APPLIED/READY、PDF签署、资金安排分别显示，已签但资金未清仍显示待核实。冻结PDF/归档文件使用既有私有文件鉴权入口。补款只导航既有普通bill详情，不自动调用requestPayment；退款仅只读显示服务端状态，没有退款写入口。

验证证据：

- 新增18项行为回归，首次11项红→绿；后续补齐终态/缺正式文案/缺归档、网络回读、普通账单跳转、初始revision=0草稿及列表摘要/期限边界，新增行为先红后绿。
- `npm test`：112/112通过（原94项+B1新增18项）。
- `npm run build`：87文件，16 WXML/17 WXSS由真实编译器通过。
- `node scripts/verify-reference.cjs`：109文件×2副本，0差异。
- `node scripts/verify-delivery-delay-layout.cjs`：真实wcc模板配离线合成数据，11种状态、11PNG、390×844视口，无横向溢出、JS异常或外部网络请求。证据见`delivery-delay-layout/report.json`；已目视未勾选完整方案与已签资金待核实两版。
- 按仓库设置运行`git diff --check -- apps/miniprogram`通过。

边界：本轮没有调用任何业务API、原生SDK、微信开发工具预览/上传、真实支付、实名或签署；截图属于浏览器离线渲染，不是真机验收。实际B1 API闭环、正式延期补充文本批准发布、供应商微信业务域名与刷脸参数及真实交易范围由主控另行核验。法大大只读准备度另见`docs/integrations/fadada-wechat-readiness.md`。

独立API只读审查报告见`delivery-delay-api-review.md`。审查发现初始发布raw模板与客户完整已填正文不匹配、报价期限未建模及占位文字缺口，已同步API和主控。主控随后授权最小原生兼容：列表独立读取quoteSummary，不拉取个人全文/finance/contract；详情仍要求已填正式正文。quote.expiresAt及quoteSummary.expiresAt为ISO时区时间，页面按北京时间显示，过期/缺有效期限不允许首次确认，点击前fresh复核；已确认后的签署/查询/历史不受此首次确认期限阻断，印章授权期限仍独立。没有客户端自动续期/新报价动作或放宽变量校验。

后续纯本地12期合成PDF核验已完成，见`delivery-delay-pdf-review.md`。真实draft+当前writer渲染路径、生产镜像提取的Noto TTC，最终5页142522字节，SHA256 `5d3f1ff636a406ca9291016ea948c76ce184a3994edc1de04b1cf48fb17915ab`；五页均目视、12服务期+12资金行完整、中文/¥清晰、4签署位置同组同页不重叠。首次样张暴露并由API负责人修复标题/签区/技术字样与生产TTC加载问题，失败证据保留；另有非阻断章节标题跨页观察如实记录，主控已接受视觉核验并要求停止追加排版。数据库/网络调用均0，没有真实签章或法律批准。
