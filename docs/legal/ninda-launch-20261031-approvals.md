# 本轮正式文本确认记录

此记录区分用户批准正文与生产发布。候选正文和样张封包保持不变，正式模板版本号须按实际新宁达已有记录确定，不能覆盖已签历史。

## 已批准：未开始续期取消协议

- 类型：OFFLINE_RENEWAL_CANCELLATION。
- 正文：docs/legal/drafts/ninda/launch-20261031/offline-renewal-cancellation.md。
- 原始正文 SHA-256：634c2d934ec64824b172bbf533e5851fffac52e0fc500abd7b39240631db3889。
- 审阅样张：docs/legal/drafts/ninda/launch-20261031/samples/renewal-cancellation.pdf；SHA-256 f360ff0214c8d9967ff2d3822aaedbeee3094827d79cbad4108e88872f5e7232。
- 2026-10-31 本聊天逐项确认，用户回答：“批准这份正文用于上线”。
- 该批准针对精确正文；样张的人名、车辆、金额、日期均为合成示例，不代表批准任何真实交易、签字或事实。
- 当前仅记录批准，尚未在生产创建或启用该模板。

## 已批准：车辆订阅补充协议

- 类型：OFFLINE_ORDER_AMENDMENT。
- 正文：docs/legal/drafts/ninda/launch-20261031/offline-order-amendment.md。
- 原始正文 SHA-256：e7fab549049a0cb7cf4508f09e635c9829bcd47efb56afe203e64ec8819d2301。
- 2026-10-31 用户对第2份逐项问题回答：“批准这份正文用于上线”。
- 用于延期、同价换车、升级换车和同车续期，具体事实仍由每次已审批并经客户确认的方案填入；不以模板批准代替真实订单确认、交接或资金核实。

## 已批准：里程使用规则

- 类型：usage-policy-v2。
- 正文：docs/legal/drafts/ninda/launch-20261031/usage-policy-v2.md。
- 原始正文 SHA-256：78a9843f72bbf2c09dad7a96b8bd9553a0e5514c4e5b7c625c6b63ea3aad657e。
- 2026-10-31 用户对第3份逐项问题回答：“批准这份正文用于上线”。

## 已批准：额外换车单次服务费说明

- 类型：swap-credit-v2。
- 正文：docs/legal/drafts/ninda/launch-20261031/swap-credit-v2.md。
- 原始正文 SHA-256：2c44d8d4fef88cccc3765c2fc4add8ea1413df176edd14c2c399914107a053a7。
- 2026-10-31 用户对第4份逐项问题回答：“批准这份正文用于上线”。
- 逐项问题明确包含：完整未用且未预占的次数，核对原付款后按原实收全额退款，由财务独立复核；已消费、预占中或争议先核实。

## 发布状态

四份正文均获批准，无待重复询问项。原候选封包中“未批准”是制作时点记录，保留不覆盖；正式使用以本批准记录及精确正文hash核验。尚未在生产创建或启用本轮模板。发布时使用实际可用的新版本号，不能改旧已签版本；所有真实具体交易和签署仍须其自身事实与授权。
