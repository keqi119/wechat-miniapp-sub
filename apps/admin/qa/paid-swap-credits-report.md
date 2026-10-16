# B3 后台实施与冻结报告

2026-10-16。仅修改 `apps/admin`，接已定稿 `apps/api/b3-contract.md`。没有生产访问、真实短信/支付/退款/签署、部署或修改旧项目。

## 已完成行为

- 购买来源列表/筛选/详情：固定80000分、本订阅一次、原账单及付款、可信到账时间、有效末日、专门同意版本/hash、预占/消费/退款来源链接。
- ADMIN/FINANCE 依严格 safe 能力安全关闭未付购买；运营/客服只读。无后台新增、编辑金额、代客户购买/支付、手工发放或标记到账。
- 完整未用无预占来源可提交原 payment 固定80000分例外退款，保留原请求键，跳已有独立财务审核。失败/未知仍冻结，沿原退款核对。
- safe.canRestore 及 restoreRefundId 开放时，明确填写原因恢复原来源；不重新发 credit。FAILED/PROCESSING/未知退款不可恢复。
- 换车账户保留真实五项付费计数、原购买及当前全文；nullable change/cycle 不构造假链接，来源流水支持 GRANT/FREEZE/EXPIRE/REFUND/RESTORE。缺字段显示未取得，不假定余额为零。
- 交叉审查发现公共 ApiClient 旧会话401误退出新登录的 P2。三个 Promise 交错回归先红后绿：旧401、旧成功POST、JSON解析期间换账号；sessionGeneration 在响应边界使旧反馈失效，不清新会话。

## 验证证据

- `pnpm --filter @chundian/admin test`：83/83；`typecheck`通过。
- B3 隔离浏览器11组、B2既有14组、B1既有8组全部通过，均0 JavaScript错误；390px无横向溢出。`swap-credit-browser-fixtures.json`、`swap-credit-refund-mobile.png`。这些均是拦截fixture，不能当作真实HTTP或真实渠道证明。
- 真正本地HTTP：`scripts/qa-swap-credits-http.mjs`，独立 `chundian_b3_ui_acceptance` / `127.0.0.1:3191`，页面3190；不拦截API，随机合成账号只在 `.runtime` 读取，不输出/保存到证据。起始已交车事实为API作者合成基线，支付仅依赖注入替身的可信查询结果，未调用微信付款。
- 6组真实HTTP闭环通过，0页面错误：真实三角色登录/分页状态筛选；后台关闭原未付购买并回读VOID账单且无credit；FINANCE原付款80000申请后同credit冻结、可用0/冻结1；另一ADMIN在渠道审批前拒绝后仍冻结；FINANCE显式恢复后原credit/payment不变、RESTORE恰1条、可用1/冻结0；OPS UI和API只读及安全投影。`swap-credit-real-http.json`只记录路径/角色/HTTP状态，不含密码、令牌、手机号或供应商原文；`swap-credit-real-http-restored.png`已目视核对。
- 客户作者同时真实回读冻结及恢复两个节点，见小程序 `evidence/paid-swap-http/customer-refund_pending.json` 与 `customer-active.json`。此本地验收未批准退款渠道发送、未预占或消费换车次数。
- 首轮脚本遇到隐藏 option 同文案和从冻结状态重跑仍用 ACTIVE 筛选等定位问题；修正测试选择器/回读恢复，复用原单继续，没有为凑成功新建购买或假清款。B2新增付费摘要令“第2周期”出现两处，旧fixture定位已收紧到实际周期标题。
- `git diff --check`与脚本语法检查通过。API/原生独立只读审查报告分别 `paid-swap-api-review.md`、`paid-swap-native-review.md`；当前无未解决P1/P2资金或权限阻断。

## 冻结产物

独立生产构建 `qa/b3-build/dist`（构建目录忽略，不入Git）。实际运行产物并拦截网络验证 `/admin/auth/me`、`/admin/auth/login` 均精确请求 `https://mini-api.subauto.keybox.cloud/api` 且 `credentials:include`，0错误，绝非验收3191地址。证据 `api-target.json`。此验证不向生产发请求。

- `assets/index-BZ71Zy3J.js` SHA256 `6DE94F5171609AE1FE586C913C787E04C2E50ABBD25A00D5F6BF195A5A581560`
- `assets/index-Bjs3Pehh.css` SHA256 `8CD0AE7BC86378E89A12BD0EE826FE953A5DEE5FCA98164FCFDE7A1AA25B9738`

源码和上述产物冻结待主控发布。验收服务器早于最后“ACTIVE预占文案”和“归还后免费余额0”两项投影补丁启动；本次未涉及预占/最终归还，资金/权限/restore与最终源码一致，两项源码及作者HTTP红绿回归已独立核对。不将本地替身验收描述为真实微信或生产资金成功。
