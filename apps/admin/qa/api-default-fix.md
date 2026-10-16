# 生产后台 INVALID_RESPONSE 最小永久修复

2026-10-16。主控复现后台同站 `/api/health` 得到 HTTP200 text/html 静态 index。本轮只修后台 API 默认地址，不改 Nginx、H5、API、数据库或业务流程；没有生产调用、真实账号或登录。

根因：`src/core.ts` singleton 原先 `VITE_API_BASE_URL || '/api'`，生产构建漏传变量时也使用同站 `/api`，但后台 Nginx 不反代该路径。HTML 在 API JSON 解码处成为 INVALID_RESPONSE。

先用实际旧 dist 在本地 Chrome 拦截所有动态网络复现红测试：会话 GET 与登录 POST 分别请求 `http://127.0.0.1:3104/api/admin/auth/me` / `auth/login`，fixture 返回200 HTML，断言批准 API 地址失败。未用真实凭据或实际网络。

最小源码改动：显式非空 `VITE_API_BASE_URL` 仍优先；缺省时 `import.meta.env.PROD` 使用 `https://mini-api.subauto.keybox.cloud/api`，开发仍 `/api`。

最终验证：

- `node --experimental-strip-types --test apps/admin/src/core.test.ts`：**14/14**，覆盖 Cookie/CSRF/权限/网络与JSON错误、跨域文件基址及 fetch 绑定。
- 清空构建进程中的 `VITE_API_BASE_URL` 后 TypeScript + Vite build 通过；实际 dist Chrome 网络检查：GET auth/me 与 POST auth/login 均请求精确批准 HTTPS API，`credentials:include`，0 JS错误。
- 实际本地 Vite3100 Chrome 网络：仍请求 `http://127.0.0.1:3100/api/admin/...`，credentials include。
- 隔离输出目录 `qa/api-override/dist/` 另构建显式合成 `VITE_API_BASE_URL=https://qa-api.invalid/api`；实际 override bundle Chrome 请求该覆盖地址且 credentials include，所有请求被拦截，无外部访问。**没有覆盖供主控部署的 dist**。
- 再对正式默认 dist 复查批准地址通过；`git diff --check` 通过（仅已有 Windows LF/CRLF 提示）。

部署冻结产物：`dist/assets/index-CBCE-9IE.js`，SHA256 `FC2F32343FC5B44A1D2E236CB2D953DF7AE4D6FFE298161AAB58F92FC0B5C8AA`；CSS 未变 `index-DkjolyJQ.css`。正式 dist 未在 override 测试重建或覆盖。

本次建议精确提交文件：

1. `apps/admin/src/core.ts`
2. `apps/admin/README.md`
3. `apps/admin/scripts/qa-api-target.mjs`
4. `apps/admin/qa/api-target.json`
5. `apps/admin/qa/api-target-development.json`
6. `apps/admin/qa/api-target-override.json`
7. `apps/admin/qa/api-default-fix.md`

**排除**未提交 B2 的 `swap.ts` / `swap.test.ts` / `vehicle-change-ui-plan.md`，其当时是8项先红占位，未被接入 App，也未进入此部署。未为此紧急修复运行无关 API/共享DB或后台全套；没有将局部14项报告为整个工作区全绿。主控执行提交与上线，本代理未提交。
