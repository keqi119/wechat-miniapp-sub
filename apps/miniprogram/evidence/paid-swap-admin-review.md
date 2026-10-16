# B3后台独立只读审查

2026-10-16。仅阅读主工作区apps/admin源码、纯内存复现与测试，不修改后台、不访问共享DB/生产/真实渠道。范围为swap-credits.ts、swap-credits-ui.tsx、swap-credit-resources.ts、swap.ts、swap-ui.tsx及App/core接线。

固定80000分/1次、后台无代买/代付/手工发次，客户独立同意记录只读；退款与restore依据safe能力及ADMIN/FINANCE角色与权限，金额固定、来源绑定、稳定key保留未知响应。父购买状态决定冻结/可用，历史退款拒绝不会自动恢复，显式restore只核查原权益、不新增次数。未发现额外明确资金或归属阻断。

发现P2：旧账号请求挂起后重新登录，新账号可能被旧401清掉session/onExpired；旧成功回包也可能在新账号显示。使用真实ApiClient纯内存promise可复现，无DB。已即时报告主控与后台负责人，由其实现request捕获session+generation、fetch/JSON后核对、每次setSession递增。

修后独立读回源码并执行 `node --experimental-strip-types --test src/core.test.ts`（apps/admin）：17/17通过，包括旧401不清新session、同对象重登录旧写响应丢弃、JSON解析期间切账号丢弃。该P2已关闭。后台负责人另做浏览器/HTTP验收，结果不冒称为本审阅者执行。

原生专属业务测试与本地HTTP证据另见paid-swap-report.md；本审阅不代替真实渠道收款、退款或生产验收。
