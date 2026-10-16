# B3 API 独立只读审查

2026-10-16。检查 `apps/api/src/swap-purchases/{controller,view,restore,ledger,rules}.ts`、`billing/billing.ts`、`vehicle-changes/credits.ts`、`usage/returns.ts`、`auth/access.ts` 及 `common/db.ts`。没有修改 API、运行共享数据库测试或访问生产。

目前未发现未解决的 P1/P2 财务或访问控制阻断。

- 购买严格 DTO 仅固定产品、独立同意及稳定键；本人订单、当前 terms/privacy、当前专门文案 hash、有效订阅均在服务端检查。80000 分账单由服务端生成，没有手工加余额接口。
- 可信付款按订单锁重新取支付及账单；支付成功必须金额一致、有交易号、未重复记账。唯一 credit.sourcePaymentId 及来源流水键配合可串行事务避免重复发放。VOID/退订/到期后的可信晚款仍记原实收并冻结；已完成结算会重开核账。
- 退款申请和审批都核对完整未用、未预占及固定全额；累计退款限制包含处理中和待审批。同一订单/account 锁与预占、交接完成及归还共用。失败/未知不自动解冻。
- 显式恢复仅原付款成功、原账单实收、原 FROZEN credit 未用未预占、全部退款未经审批即 REJECTED、订阅仍有效；只改原 credit 并追加 RESTORE。请求键及内容 hash 防重复恢复/修改原因重放。
- 归还结算包含未知支付/待审批退款与冻结购买阻断；到期清理没有把未知渠道记录当作未付款。close 的真实查询/关单在原 payment 上执行，终态和再次发起付款由事务重新检查。
- 资源各后台角色只读；close/restore 显式 ADMIN/FINANCE。客户读取按本人过滤。safe 显式白名单，不返回 OpenID、预支付参数、原始供应商响应或实名材料。

已向 API 作者提示一项展示一致性：ACTIVE 且 reservedChangeId 存在时，statusMessage 应写“已到账并预占，不可另用”，避免摘要仍称可用。作者已补 HTTP 红绿回归，最终源码改为“已到账一次，已为当前换车预占，不可另行使用”；只读复核确认。另免费余额现同时考虑 ACTIVE 与尚未归还，不向已归还客户显示可用免费次数。独立验收服务器启动于两项文案/投影补丁之前，资金、权限及 restore 与最终代码一致；本轮后台未创建换车预占。真实本地 HTTP 接线记录单独保存，不把隔离浏览器 fixture 当作真实 API 通过。
