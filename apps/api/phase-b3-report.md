# B3 付费换车次数 API 交付记录

2026-10-16。接续 B2、原生签约入口集成，不改已发布真实环境、不调用真实支付/退款/实名/签章。当前为本地验证候选；前端真实 HTTP 接线报告另由对应代理记录。

## 行为

- 每笔固定一份、一次、80000分CNY；当前订阅有效且未最终归还，用户主动同意当前已发布vehicle-change全文版本/hash后创建专用购买快照和SWAP_CREDIT账单。重复键同内容复用原记录，不能客户端改价/改次数，也没有后台手工发放接口。
- `SWAP_CREDIT_PURCHASE_ENABLED`默认false，创建购买和已有账单新发起支付均在服务端检查；原支付查询、可信到账及退款处理不受暂停购买影响。变更DRAFT阶段只允许已独立同意、有效的SWAP_CREDIT支付，月费/押金/里程包仍走原补充协议资金门禁。
- 可信付款到账原子记录Bill/Payment和唯一来源credit/GRANT；回调重放不重复发放。归还、到期或已关闭购买收到晚到款，保留真实收入和来源，冻结为PAYMENT_REVIEW、可用次数0；原退订结算若已结束则重新进入待核账，不伪称已核清。
- 免费优先，按物理完成日期的12个月周期；跨周年时释放旧付费预占，使用新周期免费次数。购买不改变原服务期或里程，实际完成仅消费一次。
- 退款仅完整未用、未预占、全额例外；申请即同订单锁冻结，另一财务审批后调用既有网关。拒绝/失败/未知不会自动恢复次数；真实退款成功唯一REFUND并退休来源。
- 仅所有退款均在渠道审批前被拒、原款真实成功、原次数完整且订阅有效时，财务可明确`restore`同一credit；绑定最新退款id、理由与幂等键，留RESTORE审计。曾渠道审批/FAILED/PROCESSING/未知均不能恢复。
- 归还和到期关闭未发起支付购买，未知支付保留原单等待核查；已付未用次数失效。安全列表先清理到期再筛选，首次账户GET中余额、预占释放及EXPIRE流水一致。有效账户普通读取不无故增加订单revision。
- 客户/后台安全投影不含openid、预支付参数、供应商原文或身份字段；后台关闭/恢复仅ADMIN/FINANCE，客户只可读本人、主动购买和安全关单。退款仍沿原独立双人复核。

## 精确文件清单

新增：

- `apps/api/b3-contract.md`
- `apps/api/phase-b3-report.md`
- `apps/api/prisma/migrations/202610160018_paid_swap_credits/migration.sql`
- `apps/api/src/swap-purchases/controller.ts`
- `apps/api/src/swap-purchases/ledger.ts`
- `apps/api/src/swap-purchases/restore.ts`
- `apps/api/src/swap-purchases/rules.ts`
- `apps/api/src/swap-purchases/view.ts`
- `apps/api/test/swap-purchases.test.ts`
- `apps/api/test/manual/b3-ui-server.ts`

修改：`apps/api/prisma/schema.prisma`、`src/app.ts`、`src/auth/access.ts`、`src/billing/billing.ts`、`src/order-changes/finance.ts`、`src/usage/returns.ts`、`src/vehicle-changes/account.ts`、`src/vehicle-changes/credits.ts`。

未改根.env/根锁/前端目录、001–017历史迁移及15固定来源文件。主控已单独维护根.env.example开关。此前自建未跟踪`native-signing-return-plan.md`含过时施工状态，主控授权后验证源/目标绝对路径在本项目且目标不存在，移动至`.runtime/archive/native-signing-return-plan.md`；正式原生实现报告已在ec18367，无需把旧笔记混入B3。

## TDD 与验证证据

- 首两购买HTTP测试先因route缺失404失败，再通过；新增消费状态测试先ACTIVE≠CONSUMED；VOID晚到款、拒绝退款后预占、真实归还失效分别先红；restore缺route与DRAFT付款阻断先红；有效账户revision读取、首次到期列表/账户投影、预占文案与归还免费可用数也分别先红后修。证据为`.runtime/swap-purchases-*-red.log`、`.runtime/swap-first-expired-red.log`、`.runtime/swap-safe-label-red.log`。
- `NODE_ENV=test pnpm --filter @chundian/api test`：205/205通过，0跳过，229.3秒，`.runtime/b3-api-full.log`。这是首次到期账户顺序及最后两个安全文案/投影补丁之前的完整快照，不冒称最终全部206项已经整套跑过。
- 最后对应补丁后：`NODE_ENV=test pnpm --filter @chundian/api exec tsx --test --test-concurrency=1 test/swap-purchases.test.ts test/vehicle-change.test.ts`：34/34通过（B3 18+B2 16），0跳过，70.3秒，`.runtime/b3-b2-final.log`。覆盖首次到期GET一致性、预占标识、最终归还免费不可用、金额/归属/幂等/退款冻结/恢复/消费并发、晚到款和三方状态。
- `pnpm --filter @chundian/api build`、`git diff --check -- apps/api`通过。
- `pnpm exec vitest run apps/api/test/fadada-api-client.spec.ts apps/api/test/fadada-digest.spec.ts apps/api/test/enterprise-seal-policy.spec.ts apps/api/test/enterprise-seal-signing-plan.spec.ts --reporter=dot`：4文件51/51通过，`.runtime/b3-fixed-source.log`。manifest中15文件SHA均未变化。
- 原生+B2合并先前58专项、缺consent提示24专项分别由e5d053d和9732ba2记录，不重复算作B3新增测试。

一次关单与SUCCESS并发测试曾出现Payment仍CLOSED，原Promise.allSettled未记录失败原因；后增诊断断言的5次单例均未再次复现，不能称已证明最初失败的全部原因。代码审查发现SWAP到账先写Bill再锁Order，与关单/归还相反，已将SWAP支付及退款settle改为先同订单锁再读/写资金行，保留晚SUCCESS优先。修改后18专项、完整205及末34相关回归通过；该事实与单次失败未完全复现分开记录。最早误启动完整套后已主动停止，未把中断运行列为通过。

## 迁移与独立浏览器验收

新增目录最终为`202610160018_paid_swap_credits`，与既有001–017正确排序。最初本地命名`018_paid_swap_credits`会在空库排到依赖表之前；主控发现后已改名，仅修新独立本地dev/test的_prisma_migrations对应名称，旧迁移文件未改。真实生产从未应用错误名称。

新建仅本地`127.0.0.1:55432/chundian_b3_fresh_test`，确认public表为空后执行完整`prisma migrate deploy`，001→018全部18项成功，`.runtime/b3-fresh-migration.log`。第一次脚本schema相对路径错误并未执行迁移，修正后才记录成功。

`test/manual/b3-ui-server.ts`仅NODE_ENV=test且UI_ACCEPTANCE_ENABLED=true可启动；硬校验127.0.0.1:55432新测试集群，使用独立`chundian_b3_ui_acceptance`（不是chundian_test）。全部18迁移应用；真实createApp及cookie/CSRF/Bearer登录，真实业务控制器；供应商仅显式测试替身，法大大/原生/H5/真实微信/验收支付开关关闭。bind仅127.0.0.1:3191，前端3190受限Origin。随机本地账号只写忽略目录`.runtime/b3-ui-acceptance.json`，不入Git/证据输出。

起始ACTIVE订单、历史首月已付款和初交付事实来自已通过测试同类合成夹具；新购买、报价、复核、支付状态查询均需真实HTTP。支付替身首次query返回合成SUCCESS，不得将其参数传微信SDK或声称真实渠道验收。两个前端已获窗口和同订单协作说明；本报告不预先宣称他们的操作结果。保持夹具进程供接线，结束后由主控统一停机；不操作生产。
