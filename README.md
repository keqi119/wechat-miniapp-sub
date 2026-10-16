# 纯电主义独立订阅平台

本仓库包含原小程序的可迁移原样副本、真实微信小程序、运营后台、独立 API 和部署配置。旧项目只作为源码和供应商配置参考，不共享客户、车辆、订单或数据库。

## 当前交付状态

2026-10-16，截至 14:25（Asia/Shanghai）：生产基础版本 `20261016-1320` 已部署。

- 后台：<https://mini-admin.subauto.keybox.cloud>
- API 健康：<https://mini-api.subauto.keybox.cloud/api/health>
- 新数据库、上传目录、服务及备份均独立。生产车辆与套餐由运营录入，无演示库存。
- 已批准正式文案发布，微信隐私指引与请求、上传、下载合法域名已登记。
- 微信开发版 `1.0.0` 已上传，包大小 328406 字节；尚未提交代码审核和正式发布，见 [上传证据](docs/evidence/wechat-development-upload.json)。
- 用户已真机完成微信一键手机号登录和自建阿里云短信备用登录；生产库已核对同一客户的微信绑定、正式协议同意及短信首次验证消费记录。旧配置中的中文外围引号导致短信首次发送失败，现已修正并补充导入校验；指定模板为 `SMS_508385053`。
- **正式微信发布及完整业务验收尚未完成。** 支付/退款、法大大实名/企业签章和签后归档仍待验收，相关开关保持关闭。法大大 textapi 历史记录标记为生产，当前供应商环境及印章归属尚未取得确认。网页或健康接口可访问不能替代业务验收。

详见 [生产核验](docs/evidence/production-deployment.md)、[小程序核验](docs/evidence/miniapp-verification.md)、[实施计划](docs/superpowers/plans/2026-10-16-independent-platform.md)。

## 目录

| 目录 | 内容 |
| --- | --- |
| `reference/miniprogram-mock` | 109 个可迁移文件的原样副本及原测试，不用于正式业务 |
| `apps/miniprogram` | 保留原页面视觉的微信原生客户端，生产无 Mock 回退 |
| `apps/admin` | React 运营后台、权限和表单，以及验收脚本 |
| `apps/api` | NestJS / Prisma API、业务事务、供应商集成和测试 |
| `docs/legal` | 用户批准的正式文案、原稿与摘要记录 |
| `deploy` | Docker、Nginx、备份、维护、证书及回滚配置 |
| `scripts` | 配置导入、发布及预检工具 |

## 本地启动

使用 Node.js 22–24、pnpm 11.7 和 Docker。根 `.env.example` 复制为 `.env`，填写独立开发数据库密码及随机会话/加密密钥。供应商和小程序上传配置分别参考 `.env.providers.example`、`.env.miniapp.example`；真实值只放忽略的本地文件。

```powershell
pnpm install --frozen-lockfile
docker compose --env-file .env -f deploy/compose.local.yml up -d
pnpm --filter @chundian/api prisma:generate
pnpm --filter @chundian/api db:migrate
pnpm --filter @chundian/api admin:bootstrap
pnpm dev:api
```

另一终端运行 `pnpm dev:admin`，访问 `http://127.0.0.1:3100`（与示例 `ADMIN_ORIGIN` 一致）。本地数据库仅监听 `127.0.0.1:55432`；API 使用 3101。管理员引导命令只创建首个账号，不覆盖已有管理员，凭据来自本地配置。

## 验证与构建

```powershell
pnpm --filter @chundian/api test
pnpm --filter @chundian/admin test
pnpm --filter @independent-platform/miniprogram test
node apps/miniprogram/scripts/verify-reference.cjs
node --test scripts/tests/prepare-production-config.test.mjs
node --test scripts/tests/provider-sms-config.test.mjs
pnpm build
```

API 集成测试会清理专用测试库，请确保 `TEST_DATABASE_URL` 指向 `chundian_test`，不能使用正式库、旧库或并发运行多个 API 测试进程。后台浏览器脚本的合成数据只用于独立本地开发库；见 [后台说明](apps/admin/README.md)。

小程序生产源码包位于 `apps/miniprogram/.artifacts/production`，导入已授权的微信开发者工具；保留 `urlCheck=true`。法大大实际签署承载域名核验完成前，`signingHosts` 保持空值，拒绝未经核验的入口。

## 生产操作

完整步骤和回滚方式见 [部署说明](deploy/README.md)。生产配置、私钥、数据库和备份密钥均不进入 Git 或前端。重新生成配置必须保留现有独立数据库密码和实名资料加密密钥。

正式业务需要真实运营账号、双人复核、印章授权和逐单商业附件。真实支付/退款、实名与签署按明确验收对象、金额和文档范围进行；不能用演示成功状态替代供应商结果。
