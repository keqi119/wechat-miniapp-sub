# B3付费换车次数客户端记录

2026-10-16，仅root apps/miniprogram；基线已合并B2和原生签署。按主控批准计划及apps/api/b3-contract.md实施。未修改reference、API/admin、根依赖/锁/法务文本、隔离native worktree或冻结发布副本，未git。

## 行为

- 固定SWAP_CREDIT_1、每笔一次、80000分/CNY，拒金额/数量覆盖；不同成功购买可以各一次叠加，未知创建响应保持原稳定key。独立全文说明id/version/hash与默认未勾选选择，fresh账户和文案能力核对后才POST。关闭/文案不可用阻止新创建，历史记录仍读。
- 只创建普通SWAP_CREDIT账单，不调wx.requestPayment、不本地GRANT、不混入0.01验收。客户点击进入原bill详情核对并主动付款，既有普通支付与可信结果机制保持。回到权益页读账户实际五计数与购买来源，ACTIVE还要求一致的PAID/80000账单及credit来源，不能凭SDK结果展示到账。
- 本人购买GET安全白名单，丢弃供应商原文、openid、prepay/支付参数/customerId。8种购买状态与paidAvailable/Reserved/Consumed/Frozen/Expired分别显示；空PAID cycleSequence、空ledger.changeId和GRANT/FREEZE/EXPIRE/REFUND/RESTORE兼容，未知状态拒绝。当前无车间隔不虚构车辆，也不额外禁止服务端允许的本订阅购买。
- 查询有paymentId的PENDING_PAYMENT时先GET原payment可信查询，再GET本购买和账户；无支付ID只回读原购买。失败不返回本地成功，不创建新交易。关单需明确点击，按同purchase与稳定key调用close；只有可信VOID才说明已撤销，未知保持待查询/人工核账。
- 例外退款仅客户只读与人工联系，无客户退款/恢复/手工发次数入口。退款失败或未知按parent购买状态冻结；历史REFUND FAILED/REJECTED子行只说明该次结果，不错误覆盖后来已恢复ACTIVE或已退款REFUNDED。RESTORE表示显式核查恢复原次数，非再次发放。
- 会话snapshot绑定customer/token/generation，各await后检查；旧会话回包丢弃，旧finally不解锁新lease。页面busy防双击，刷新/文案变化/成功创建均清独立选择；只导航已知本人购买的原账单。

## 已执行验证

- 新增23行为回归，其中18项实际观察RED→GREEN，5项后续补充通过；专项23/23，最后完整客户端176/176，0skip。含固定规格/未同意/变版/关闭/幂等多笔/归属/敏感字段/原支付query/晚到款/关单未知/同客户换token/退出/旧finally/无车间隔/独立勾选、历史退款文案、预占原来源及可信VOID重试不重复POST。
- build96文件、17WXML/18WXSS；reference manifest109文件×2副本SHA零差异，diffcheck无错误。
- `node scripts/verify-paid-swap-layout.cjs`：18actual-wcc离线合成状态、18PNG、390×844，零溢出、JS异常或外部请求。覆盖默认未选/主动选择/关闭/无文案/无车间隔、8状态、失败冻结、原权益恢复、多笔来源、预占原来源和未知关单。已目视未选购买说明、晚到款人工核账、恢复原权益及预占来源版面。逐页结果见[paid-swap-layout/report.json](paid-swap-layout/report.json)。

## 本地HTTP与交叉审阅

- `node scripts/qa-paid-swap-http.cjs`：独立合成UI验收库、真实createApp/auth/HTTP接线，11项检查/19次请求通过；固定80000、独立同意、多笔创建、未付不加次、原单关单VOID、普通账单/pay参数契约、DI支付替身可信query后ACTIVE与余额+1。没有把支付参数交给wx.requestPayment，未访问真实渠道。[customer.json](paid-swap-http/customer.json)仅记录合成ID与安全状态，密码/手机号/token/支付签名不入证据。
- 后台FINANCE申请全额例外退款后，客户safe只读回读REFUND_PENDING、可用0/冻结1、原credit/80000已收不变，不能付款或关单；[customer-refund_pending.json](paid-swap-http/customer-refund_pending.json)。另一ADMIN在渠道审批前拒绝、FINANCE显式restore后，客户再次只读回查同purchase为ACTIVE、同credit/payment/原账单已收80000、可用1/冻结0、旧refund REJECTED、RESTORE流水；[customer-active.json](paid-swap-http/customer-active.json)。两个节点各3次HTTP，无客户退款/恢复动作。后台另将第三笔pending安全关闭为VOID；后台实际6组HTTP证据由后台负责人记录，不冒称本审阅者点击。
- 后台代理独立只读原生review无未关闭阻断。我对后台B3源码只读review发现旧401可能清掉新会话P2，交后台负责人TDD修复；修后我独立运行core17/17通过，详见[paid-swap-admin-review.md](paid-swap-admin-review.md)。

## 验证边界

初期报告中“等待本地HTTP”的状态已由以上独立HTTP证据替代；离线版面和本地HTTP仍不代表真实渠道验收。未访问生产API/旧库/真实供应商，未做真实SMS/付款/退款/实名/签署、SDK/DevTools、二维码/预览/上传。当前产物包含尚未部署B2/B3，只供主控后续审阅封存，不替换线上native-v1。
