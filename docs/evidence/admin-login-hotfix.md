# 后台登录独立修复上线记录

2026-10-16 18:45（Asia/Shanghai）。用户报告第二位管理员登录页显示“服务返回了无效响应”，按钮无反应。

根因是生产后台未显式传入构建变量时，将 API 请求发送到后台域名下的 `/api`，Nginx 返回了静态 HTML。修复使生产默认 API 为 `https://mini-api.subauto.keybox.cloud/api`；显式构建变量仍优先，开发环境保留 `/api`。

为了不等待签约、换车施工，本次使用当前线上 usage 版源提交 `465304919064bff4d90b574d497590d42c6c0726` 隔离构建，只修改 `apps/admin/src/core.ts` 一处默认 API 选择。76 个源文件中仅此文件不同，不含 B1/B2 新业务页面。永久源码修复已在提交 `8b92171`。

- TypeScript 与 Vite 构建通过；实际产物的隔离浏览器检查确认 `auth/me` 和 `auth/login` 请求精确生产 API、包含 Cookie 凭据、无 JavaScript 错误，未使用真实登录资料。
- 独立静态包 SHA-256：`4785bc8200b833fb302abcf36a66175bd9ab415371db47a7407d5db9c8456fe9`。
- 入口脚本：`index-BorlHIus.js`，SHA-256 `5411f7c14d8a1f89bb575e205590d76b3fa2cfad4483db19c5d5dea847cd71ff`。
- 新静态目录 `/opt/wechat-miniapp-sub/releases/20261016-admin-login-hotfix`，`current` 已原子切换；原目录保留。公网 HTML 和 JavaScript 哈希核验通过。
- API 镜像、生产环境文件及 Nginx 配置哈希均未变化，API 仍为 `20261016-usage-v1`、数据库连接正常。
- 实际 `/api/admin/auth/me` 返回预期 401 JSON `UNAUTHENTICATED`，CORS 精确允许新后台域名且允许凭据。

第二位管理员的登录和自行改密仍待本人反馈，未代替其登录或进行用印复核。尚未将本次修复记为该人工验收已通过。
