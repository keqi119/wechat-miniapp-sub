# 宁达汽车 · 宁达订阅管理中台

宁达汽车是一套汽车订阅业务平台，连接面向客户的微信小程序 **「宁达汽车」** 与面向运营团队的 **「宁达订阅管理中台」**，覆盖选车、申请、产品配置、合同、交还车、订阅账单及用车服务。

- **客户入口：** 微信小程序「宁达汽车」。
- **管理后台：** [宁达订阅管理中台](https://admin.evsub.ndacar.com/)。
- **代码仓库：** [keqi119/wechat-miniapp-sub](https://github.com/keqi119/wechat-miniapp-sub)。

本仓库包含小程序、管理中台、业务 API、企业与签署 H5，以及配套的数据库迁移、测试和部署工具。业务数据、上传材料和生产配置独立管理；代码同步与本地验证不代表已经完成生产发布。

2026-11-13 已上线产品定价参考，并完成 ECS / RDS 资源分工调整。人工验收入口为管理中台「产品中心 → 定价参考」；计算口径见 [使用说明](docs/product-pricing-reference.md)，部署与灾备状态见 [生产发布记录](docs/operations/ninda-pricing-rds-release-20261113.md)。

## 产品与业务能力

| 产品 / 模块 | 主要用途 |
| --- | --- |
| 宁达汽车微信小程序 | 浏览车辆与订阅方案、提交申请和客户资料、查看订单与合同、账单支付、里程申报及用车服务 |
| 客户管理 | 客户档案、资料核验、申请审核与风控，按权限查看和处理客户业务 |
| 车辆与资产管理 | 车辆台账、车型、牌照、保单、BaaS 合同、资产成本、折旧、市场残值与人工估值 |
| 产品与商品管理 | 产品工作台、剩余期 ROA 定价参考与分组草稿、版本与权益配置、产品仓库，以及具体车辆和产品版本的组合发布 |
| 订单与履约管理 | 订单办理、合同档案、交还车任务、延期、换车、续期及服务记录 |
| 财务管理 | 订阅账单、支付、押金、退款、结算、逾期账单与催收 |
| 企业与电子文书 | 合作商资料、企业办理入口、授权、签署任务和文书归档 |
| 系统管理 | 员工账号、角色权限、业务配置和操作审计 |

客户小程序与管理中台共用业务 API。价格、权益、合同及订单依据采用明确版本和快照；后台关键写入校验权限、版本冲突和幂等请求。金额统一以整数分存储，生产客户端不通过 Mock 数据兜底。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `apps/miniprogram/` | 「宁达汽车」微信原生小程序及客户端测试、构建工具 |
| `apps/admin/` | 「宁达订阅管理中台」React / TypeScript 应用及现场办理页面 |
| `apps/api/` | NestJS / Prisma API、业务规则、供应商集成、数据库迁移和测试 |
| `apps/signing-h5/` | 企业办理与签署相关 H5 应用 |
| `deploy/ninda/` | 宁达环境的部署、备份、证书和发布配置 |
| `deploy/` | 本地环境与容器构建等基础配置 |
| `docs/` | API 约定、产品设计、实施计划与操作说明 |
| `docs/legal/` | 文书模板、版本及审阅记录 |
| `scripts/` | 测试入口、配置生成、构建和发布检查工具 |
| `reference/miniprogram-mock/` | 保留的历史原样副本，仅用于来源核验和回归参考 |

## 本地开发

使用 **Node.js 22–24、pnpm 11.7.0、Docker Compose**。从 `.env.example` 创建本地 `.env`，填写独立开发数据库配置及本地会话、加密密钥。供应商和微信小程序工具的配置分别参考 `.env.providers.example`、`.env.miniapp.example`；真实凭据只放在已忽略的本地文件中。

在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
docker compose --env-file .env -f deploy/compose.local.yml up -d
pnpm --filter @chundian/api prisma:generate
pnpm --filter @chundian/api db:migrate
pnpm --filter @chundian/api admin:bootstrap
pnpm dev:api
```

在另一终端启动管理中台：

```powershell
pnpm dev:admin
```

管理中台默认地址为 `http://127.0.0.1:3100`，API 端口为 `3101`；本地 PostgreSQL 仅监听 `127.0.0.1:55432`。管理员引导命令只创建首个账号，不覆盖已有账号。首次迁移与引导前应确认 `.env` 指向本项目的本地开发库。

工作区包名保留现有技术标识，以上命令以各包 `package.json` 为准。

## 测试与构建

常用检查：

```powershell
pnpm --filter @chundian/admin typecheck
pnpm --filter @chundian/admin test
pnpm --filter @chundian/api build
pnpm --filter @chundian/signing-h5 test
pnpm --filter @independent-platform/miniprogram test
node apps/miniprogram/scripts/verify-reference.cjs
pnpm build
```

API 数据库测试统一通过受保护的本地测试入口执行：

```powershell
node scripts/run-mvp-api-tests.mjs --migrate
node scripts/run-mvp-api-tests.mjs --all
```

此入口要求 `TEST_DATABASE_URL` 指向本机 `55432` 端口的专用 `chundian_test` 数据库，并通过进程锁阻止并发测试。测试可能创建、修改和清理测试数据，禁止使用生产库或旧业务库。也可将 `--all` 换为具体的 `test/<文件名>.test.ts` 执行单项测试。

小程序生产源码包输出至 `apps/miniprogram/.artifacts/production`，使用已授权的微信开发者工具导入；合法域名校验保持开启。真实支付、退款、实名和签章验收需明确对象、金额及文档范围。

## 发布与资料管理

宁达环境的发布操作以 [宁达部署说明](deploy/ninda/README.md) 和对应发布记录为准。发布时保留业务数据库、上传文件、加密密钥及已建立的企业认证和印章绑定；历史文档中的开关状态不能代替当前环境核验。

环境凭据、私钥、临时文件、实际业务输出与新增运行证据不作为源码提交。Git 记录代码与可复用配置模板，业务数据和恢复所需密钥另行备份。

## 项目文档

- [API 总约定](docs/api-contract.md)
- [管理中台开发说明](apps/admin/README.md)
- [微信小程序说明](apps/miniprogram/README.md)
- [运营操作手册](docs/operations/ninda-seven-module.md)
- [宁达部署说明](deploy/ninda/README.md)
- [产品定价参考设计](docs/superpowers/specs/2026-11-12-product-roa-pricing-reference-design.md)
- [产品定价参考使用说明](docs/product-pricing-reference.md)

2026-11-13 定价模型实施前的代码基线已保存在标签 [`baseline/pre-roa-pricing-20261113`](https://github.com/keqi119/wechat-miniapp-sub/tree/baseline/pre-roa-pricing-20261113)，便于后续比较和回溯。
