# 独立服务号 H5 签约中心实施报告

2026-10-16，本轮前端源码冻结。包名 `@chundian/signing-h5`；仅新增 `apps/signing-h5/**`。主控负责根依赖安装/锁文件、API、Nginx、生产打包与部署。本轮未提交 Git，未改旧项目、旧数据库、原公众号菜单、原门户、后台 B1 或小程序。

## 最终范围

- 固定 base `/miniapp-sign/`，仅入口与 `/miniapp-sign/return/` 两个 pathname。详情用白名单 kind/id query 与内存导航，URL 不含登录 Token、手机号、OpenID、验证码或证件。静态资产位于 `/miniapp-sign/assets/`。
- 全部 API 仅同源 `/miniapp-sign/api/*`，映射主控定稿的新系统 `/api/h5-sign/*`；不请求旧 portal/OAuth，不使用旧 Cookie、JWT、Bearer。使用后端独立 8h HttpOnly Cookie，前端 CSRF 仅内存。无 localStorage/sessionStorage、外部脚本、字体下载或 analytics。
- 现有新库手机号短信登录，当前 terms/privacy 文案查看与主动勾选；不注册客户。短信 request 最终统一 HTTP 201 `{accepted:true}`，提示“验证码请求已提交。若未收到，请稍后重试或联系平台。”，不承诺送达；公共限流或网络失败仍显示真实失败。
- 仅本人主合同 SUBSCRIPTION、延期补充协议 AMENDMENT、交接 HANDOVER 列表/详情。AMENDMENT 以 changeId 和最新 revision 操作，其他类型不编造 revision；能力/阻断以服务器 safe 为准。没有代确认、代支付、假签署或手工改状态。
- 原 PDF 审核稿与已签归档稿均通过本人受控文件端点查看/下载；正文只作安全文本渲染，不执行 HTML。未就绪准确显示等待准备，不制造空白“可签”文件。
- 本人点击后才 register/verify/refresh/sign/sync。实名用途明确包含姓名、身份证号码及已绑定手机号提交法大大；拒绝仅影响实名签约，不影响浏览和已有合同查询。用途 checkbox 默认 false；每次 verify 先 fresh GET legal，要求独立 `consent:{accepted:true,documentId,version}`；版本变化阻断并要求重新阅读确认，不能沿用登录同意。证件输入提交前清空，不入 URL/日志/持久化。
- 外链只消费 API 受控 redirectUrl，前端另验 HTTPS、无 userinfo、无非443端口；不猜供应商 URL。跳转由用户点击发起。返回页面不信任 result/success query，须选择本人记录显式 sync，并提示回小程序“我的 → 业务记录”刷新。
- 当前通道关闭、缺实名、缺审核稿/企业用印复核、网络未知或服务端拒绝均准确显示；不回退 Mock。20s 请求时限，401 清理会话/详情/CSRF。

## 测试与修复证据

TDD：客户端/导航/版本/独立实名 consent 先红后绿；最初浏览器登录视图先红；新增 SMS 中性文案、slow sign 导航锁和生产弹窗无 inline style 均观察到对应红测试后修复。

最终本地命令与结果：

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @chundian/signing-h5 test` | **10/10**：同源 Cookie、无旧 Bearer、CSRF、no-store/超时 signal、真实嵌套 API 错误、离线/HTML/401、路径拒绝、导航不信成功参数、AMENDMENT revision、外链协议校验、独立 privacy consent |
| `pnpm --filter @chundian/signing-h5 qa` | **13 组 Chrome 合成场景**，0 pageErrors，390px 无横向溢出 |
| `pnpm --filter @chundian/signing-h5 build` | TypeScript + Vite 通过，无 CSS import 警告 |
| `node apps/signing-h5/scripts/qa-production.mjs` | 本地构建产物两 pathname + 法律弹窗，严格 script/style self CSP：**0 inline styles、0 外部请求、0 JS/CSP 错误** |
| `git diff --check -- apps/signing-h5 apps/admin/qa/service-account-signing-design.md` | 通过 |

浏览器场景包含：显式短信登录/文案版本/零浏览器存储；空返回页不信伪 success；待实名阻断；独立用途确认；点按后隐私版本变化禁止 verify 并重置确认；slow sign 锁定返回/账户/资源切换；慢 sync 跨过会话过期、重新登录后迟到，不能重开旧详情或声称已查询成功；三类正确路由/CSRF/revision；签署 409 原文提示；显式 sync；401 回登录；离线不冒充无记录；入口关闭不显示登录或签署动作。

竞态实现采用同步 busy 锁、业务详情 generation、会话 epoch；record buttons/返回/退出/实名入口在动作中禁用。旧会话迟到响应不覆盖新会话。模态框采用 focus trap、Esc 关闭及焦点恢复；滚动锁使用 CSS class，未写 style 属性。手机/桌面截图已人工读取审阅。

这些是**隔离浏览器/API 合成响应与本地构建测试，不是生产端到端或真实法大大成功证明**。所有 API fixture 被拦截，无真实短信、实名、签章、支付、客户凭据、数据库写入或生产调用。合成报告中手机号/验证码/证件均省略；真实后端测试由 API 同事执行，本报告不冒领其结果。

## 产物

最终 `apps/signing-h5/dist/`：

| 文件 | 大小 | SHA256 |
| --- | --- | --- |
| `assets/index-CPs3TuwH.js` | 245115 bytes（gzip 约77.04 kB） | `84DCC04563B8B87420D599AA4BF5094FBE22388265CDED0798824B4CD78B46FE` |
| `assets/index-CEU-7291.css` | 10588 bytes（gzip 约2.99 kB） | `F7A93EF880B26446966AB2046B3729BA3EA5B36A809955BCE1B5DFB71EE18B05` |

证据：`browser-fixtures.json`、`production-bundle.json`、`login-mobile.png`、`contract-mobile.png`、`readiness-mobile.png`、`center-desktop.png`。本地 Vite 3102 session 27391 保留供主控核查。未安装新依赖类别，版本与后台已有 React/Vite/TS/Playwright一致，根安装由主控完成。

## 上线边界

主控需完成精确两页/资产/API location，不落旧 Next；配置独立 API 会话、安全 Cookie、Origin/CSRF、供应商精确允许主机和固定返回地址；原可信通知仍到新 API。与旧 portal 共享主机是业务数据/会话隔离，**不是浏览器同源 XSS 的强隔离**，详见只读审计 `apps/admin/qa/service-account-signing-design.md`。

真实本人短信登录与实名往返、Cookie 属性、微信真机外链和返回小程序同步由主控在明确授权范围验收。当前企业用印配置未完成时必须保持真实 signing 关闭；前端不会据页面跳转标记已签。
