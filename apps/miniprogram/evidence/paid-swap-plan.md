# B3客户端实施切片

依据主控批准计划与apps/api/b3-contract.md，仅root apps/miniprogram。独立80000分/CNY每笔一次，默认未勾选已发布vehicle-change全文同意，绑定id/version/hash；创建只产生普通SWAP_CREDIT账单，用户在原bill页主动付款，不在权益页自动调wx.requestPayment，不复用0.01验收。

账户严格白名单显示paid五计数、购买来源及8状态；FREE周期与PAID空周期、空changeId流水分开。查询pending购买时先按本人safe paymentId GET已有payment查询，再回读purchase和account；无paymentId仅回读。原购买关单使用稳定key，未知结果不宣称关闭/未扣款。冻结/例外退款仅显示真实safe与人工入口，不允许客户写退款或手工发次数。

TDD覆盖固定规格/文案缺失/checkbox与版本/幂等多笔/归属与会话/未知结果/可信到账/关单/退款冻结/页面busy及普通账单跳转。完成本地单元、编译、MockSHA和actual-wcc离线截图后，与admin只读交叉review；真实本地HTTP接线待core释放测试窗口，不访问生产或真实渠道，不git直至主控授权。
