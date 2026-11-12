# 宁达独立生产部署

## 2026-11-13：当前生产采用 ECS + RDS

定价参考版本 `20261113-pricing-reference-v1` 已发布。ECS 承载 Nginx、静态页面和单实例 API；业务数据库已迁入同 VPC 的 PostgreSQL 17 高可用 RDS，内网连接强制 TLS。API 容器上限 2 GiB、Node 堆 1 GiB、连接池 12；旧本地 PostgreSQL 已停用，其卷保留供核对。下方按日期保留的本地库、旧资源上限、首次空库初始化和发布脚本均是历史说明，不能直接套用于当前生产。

当前 Compose 源文件为 [`compose.rds.yml`](compose.rds.yml)，部署时安装为 `/opt/ninda-platform/deploy/compose.production.yml`。保持当前线上 `.env.production`、`.env.active` 与 `secrets/`，只更新核对过的发布字段。旧 `prepare-production-config.mjs` 生成的本地数据库 URL 不能覆盖当前 RDS 配置；旧 `activate-release.sh`、`activate-mvp-release.sh` 不能直接用于此架构。不要启用 `legacy-local-db` profile 或运行数据库初始化。

备份采用 [`rds-backup.py`](rds-backup.py)，`backup-rds.sh` 和 `verify-backup-rds.sh` 分别安装为服务器的 `backup.sh`、`verify-backup.sh`。RDS 客户端凭据只在 `secrets/rds-client.env`；OSS 使用 ECS 专用角色，通过 IMDSv2 临时凭据访问固定私有内网桶，服务器不存长期云 API 密钥。

详细部署状态、备份恢复步骤、保留规则、预算预警待办与人工验收见 [本次生产发布记录](../../docs/operations/ninda-pricing-rds-release-20261113.md)。以该记录和当前生产只读核验为准。

## 2026-11-10：保留企业实名认证和印章

晓浪、宁达的企业及法人认证、电子签账号、证书和本人选定印章已经保存在宁达生产数据库；受保护的材料与签署文件保存在持久上传目录。它们是业务数据，不随前端构建或 API 镜像重建。2026-11-10 的 API 补丁及 H5 发布前后已作只读指纹比对，两家公司的认证、证书和印章记录均保持一致，平台账号与印章配置绑定一致；两份合作文书均已归档。见 [本轮发布及保留核验](../../docs/evidence/v31-owner-h5-documents-20261110.json)。

后续常规发布必须保留生产数据库卷、上传目录、实名加密密钥及现行平台账号/印章绑定，不运行初始化、测试重置或重建企业账号的流程。发布前完成加密备份，发布后只读核对既有认证、证书和已选印章；不要通过再次发起认证来验证发布。

认证过期、失效或企业/法人认证材料变更，仍按现行规则重新办理。软件版本变化本身不构成重新认证理由；已认证和选章不等于启用自动用印。本轮仍由本人逐份签署，小程序 1.3.0 仍禁止正式发布。下方按日期记载的旧开关状态仅为历史记录，不得覆盖当前线上配置。

2026-10-31 后台重做施工：用户确认暂缓线上实名认证，新客户凭分类身份证/驾驶证资料申请，由运营审核。候选配置使用 `CUSTOMER_IDENTITY_POLICY=MANUAL_REVIEW`；该值同时关闭新实名办理、使资料申请采用人工模式快照，不伪造线上实名成功。资格、风控、支付及交付门禁不变。发布前验证公开 `identity-config.identityPolicy` 和客户资料就绪状态；配置缺省仍为 `PROVIDER_REQUIRED`，不因缺凭据自动降级。此段为本地改造说明，尚未部署或修改宁达实际配置。

2026-10-27 实际发布已完成 `20261027-seven-module-mvp-v4`，采用独立入口 `activate-mvp-release.sh`，先维护停写、备份及恢复验证，再执行迁移。首次按用户要求空业务库切换；后续补丁使用 preserve，不能再次使用 fresh，新环境已发生的建档记录完整保留。模板、小程序及剩余验收状态见 [生产发布记录](../../docs/evidence/ninda-seven-module-release.md)。通用旧激活脚本的旧镜像自动回滚不适用于本版。

2026-10-27 七模块 MVP 更新：发布顺序与资料检查以 [七模块操作手册](../../docs/operations/ninda-seven-module.md) 为准。配置生成器现在固定 `MVP_V2_ENABLED=true / NEW_ORDER_CONTRACT_MODE=OFFLINE / ESIGN_NEW_REQUESTS_ENABLED=false`，生成或保留独立员工命令摘要密钥并设置纸质合同中文字体。不会因保留法大大历史凭据开启新签署。新功能代码和本地合成验收不代表已部署，本文下方历史外部接口启用记录不能当作本版生产验收。

目标为 `8.133.232.213:/opt/ninda-platform`（Ubuntu 22.04），数据库从空库开始。新主体为上海宁达信息科技有限公司。公网入口为 `api.evsub.ndacar.com`、`admin.evsub.ndacar.com`、`sign.evsub.ndacar.com`，三条 A 记录均指向该新服务器；不改根域名现有用途。本目录不能与上一套 `deploy/` 脚本混用。

## 固定接口

| 项目 | 值 |
| --- | --- |
| Compose 项目 / 数据卷 | `ninda-prod` / `ninda-prod-db` |
| 数据库 / 用户 | `ninda_prod` / `ninda_prod` |
| API 容器 / 宿主端口 | `3101` / 仅 `127.0.0.1:13101` |
| API origin | `https://api.evsub.ndacar.com` |
| 后台 origin | `https://admin.evsub.ndacar.com` |
| H5 origin | `https://sign.evsub.ndacar.com` |
| H5 路径 | `/miniapp-sign/`，返回 `/miniapp-sign/return/` |
| 小程序 / 服务号 | `wxb5115e5a5f70f1b1` / `wx556ac6833f4c4d30` |
| 微信商户 | `1749304222` |
| TLS bundle | `/etc/letsencrypt/live/api.evsub.ndacar.com/{fullchain,privkey}.pem` |
| Nginx vhost | `/etc/nginx/conf.d/ninda-platform.conf` |

数据库不发布宿主端口。对外仅开放 80、443，SSH 保持受控；API 与 PostgreSQL 的内存上限分别为 768 MiB、512 MiB。镜像仍使用仓库 `deploy/Dockerfile.api`，新标签为 `ninda-api:<版本>`。部署目录中的脚本均固定到新服务器的独立根目录，不使用宝塔。

## 私有配置与边界

先在本机把 `scripts/ninda/providers.example.env` 复制为 `.runtime/ninda/providers.env`，在受控文件中填值。不要将真实内容打印到聊天或命令输出。生成命令：

```powershell
node scripts/ninda/prepare-production-config.mjs --release=20261019-ninda-v1
```

输出只在 `.runtime/ninda/production/.env.production` 和其 `secrets/`。生成器不会读取旧 `.runtime/production` 或根 `.env.providers.local`。它逐字段读取明确白名单，忽略任意数据库、回调、开关及未知供应商输入；不展开环境变量。法大大仅允许显式导入示例列出的账号、协议及印章标识字段，沿用这些字段不表示新公司已取得用印授权。

小程序 AppSecret 填入 `WECHAT_MINIPROGRAM_APP_SECRET`；服务号 AppSecret 使用独立的 `WECHAT_OFFICIAL_ACCOUNT_APP_SECRET`。支付私钥、APIv3 密钥和序列号必须属于新商户；提供任意支付凭据时，输入必须明确同时写 `WECHAT_PAY_MCH_ID="1749304222"`。生成器校验声明身份一致，但不能凭私钥文件证明微信平台归属；真实启用仍须通过商户平台核验。支付文件以内容 SHA-256 命名为 `payment-<摘要>.pem`，不可覆盖地写入新 secrets，并映射到 `/run/ninda-secrets/`；不使用来源 basename，不输出密钥或摘要。同名来源文件内容变化会生成不同目标文件，旧文件保留供旧配置回滚；相同内容重跑复用原文件，已存文件内容异常时拒绝继续。上传 secrets 时必须采用增量复制，禁止同步删除旧文件或覆盖 `backup.key`。

新文件的支付、支付验收、短信、法大大注册/实名/签署、H5、原生签署、技术签署、车主、换车权益等开关均为 `false`；输入文件里的 `true` 不会开启。价格验收和定位政策绑定也不从旧环境复制。重跑保留**宁达输出目录**中的数据库密码、会话/JWT、管理员引导、实名加密和备份密钥，以及该文件内已经明确设置的开关；版本和供应商白名单字段按本次输入更新。先核对宁达当前配置，再重跑；不能把旧配置拷进宁达输出目录。

`PLATFORM_API_ORIGIN`、`ADMIN_ORIGIN`、`H5_SIGNING_ORIGIN` 固定为表中三个新 origin；支付/退款/验收及法大大通知固定到新 API `/api/callbacks/*`，实名与原生签约返回 `/api/public/esign-return`。不自动发布旧主体协议，不迁移旧 openid、会话、客户、合同或授权记录。

`PLATFORM_LEGAL_ENTITY_NAME` 固定为 `上海宁达信息科技有限公司`。生产启动必须明确配置；新 PDF、企业印章与签署复核按该名称核对，已批准的旧主体文档不会被自动改写。法大大 API 应用账号可沿用，但企业签署账号、证书主体、印章及本地双人审批必须分别匹配宁达。

2026-10-20 的接口启用配置将支付、法大大注册、实名及小程序实名入口打开；签署总开关仍为 `false`。用户提供的印章 ID `1792426102332525` 已在供应商查询到，但现有企业账号的证书主体仍是晓浪。用户已将宁达认证及账号绑定设为待办，并安排当日北京时间 10:00 提醒。没有用图片、新印章 ID 或保留的 API 密钥替代宁达企业认证。

## 构建与上传

本机执行（依赖安装、镜像构建由主控统一）：

```powershell
node --test scripts/ninda/prepare-production-config.test.mjs
$env:VITE_API_BASE_URL='https://api.evsub.ndacar.com/api'
pnpm --filter @chundian/admin build
pnpm --filter @chundian/signing-h5 build
docker build --build-arg DEBIAN_MIRROR=http://mirrors.tuna.tsinghua.edu.cn -f deploy/Dockerfile.api -t ninda-api:20261019-ninda-v1 .
docker save -o .runtime/ninda/ninda-api-20261019-ninda-v1.tar ninda-api:20261019-ninda-v1
Get-FileHash -Algorithm SHA256 .runtime/ninda/ninda-api-20261019-ninda-v1.tar
```

上传布局如下。`deploy/ninda/` 的文件上传到服务器 **`deploy/`**，不是 `deploy/ninda/`。上传方式可用已有严格主机校验的 SSH/SCP，私钥不随产物上传。传输后核对本地与远端 SHA-256；不要输出完整 Compose 配置。

```text
/opt/ninda-platform/
  .env.production                 # 来自 .runtime/ninda/production/.env.production
  secrets/                        # 来自 .runtime/ninda/production/secrets/
  deploy/                         # 来自 deploy/ninda/
  releases/20261019-ninda-v1/
    admin/                        # apps/admin/dist/*
    signing-h5/                   # apps/signing-h5/dist/*
  uploads/                        # 新空目录，不拷旧业务数据
  backups/
```

私有配置权限 `0600 root:root`；secrets 目录 `0750 root:1000`；API 需要的密钥文件 `0640 root:1000`；`backup.key` 仅备份进程读取，`0600 root:root`；uploads `0750 1000:1000`。静态目录在激活时统一设为目录 755、文件 644。仅加载新镜像：`docker load -i <已校验的镜像归档>`；如果主机无法拉取 Docker Hub，可在本机保存并上传已核验的 `postgres:17-alpine`。

## 首次上线

主机须已安装 Docker Engine、Compose 插件、Nginx、Certbot、Python 3、curl、OpenSSL、tar、flock；本脚本不自动重配防火墙或 SSH。先确认三个新域名均解析到本机且 80/443 可达，再在服务器运行：

```sh
cd /opt/ninda-platform
bash deploy/prepare-host.sh
bash deploy/issue-tls.sh <ACME联系邮箱>
docker compose --env-file .env.production -f deploy/compose.production.yml config --quiet
bash deploy/activate-release.sh 20261019-ninda-v1
docker compose --env-file .env.production -f deploy/compose.production.yml run --rm --no-deps api node dist/auth/bootstrap.js
```

`prepare-host.sh` 只安装新 HTTP 验证 vhost，拒绝覆盖内容不同的现有配置。已签发证书可跳过 `issue-tls.sh`，证书必须覆盖三个子域名并位于固定 bundle 路径。Nginx 语法兼容 Ubuntu 22.04 的 1.18；不使用新版专有 `http2 on`。

激活脚本启动新库、创建加密备份、执行 `dist/common/migrate.js` 的 Prisma `migrate deploy`、启动 API，确认本机健康版本，然后切换静态软链和 HTTPS 路由并检查三个入口。初始数据库由官方 PostgreSQL 镜像建立，迁移创建结构及三个默认里程商品；不导入客户、车辆、订单、合同或付款记录。管理员 bootstrap 只建首个账号且拒绝覆盖，凭据来自私有环境文件，不能粘贴到公开日志。合法协议经新公司审阅后再发布，不能运行旧域名的法律发布脚本。

验收应包括 HTTPS 证书、`/api/health` 的版本/数据库连接、后台管理员登录、未登录管理 API 返回 401、CORS、静态后台与 `field.html`、公开空目录及支付/签署关闭状态。H5 可展示但关闭开关时不能发起签署。微信端合法域名、服务号域名/菜单、小程序代码上传白名单、商户与 AppID 绑定需在对应平台单独完成。所有真实付款、实名及签章测试须取得该次明确范围。

## 备份、续期与回滚

安装 `ninda-backup.service/.timer`、`ninda-tls.service/.timer` 到 `/etc/systemd/system/`，安装 `logrotate.conf` 为 `/etc/logrotate.d/ninda-platform`，再执行：

```sh
systemctl daemon-reload
systemctl enable --now ninda-backup.timer ninda-tls.timer
systemctl start ninda-backup.service
bash deploy/verify-backup.sh /opt/ninda-platform/backups/<时间>.tar.enc
systemctl show ninda-backup.service -p Result -p ExecMainStatus -p ExecMainStartTimestamp -p ExecMainExitTimestamp
```

备份每天北京时间 03:30 附近运行，包含数据库自定义格式 dump 与 uploads，以独立 `backup.key` 加密并保存 SHA-256，30 天轮换。恢复验证仅建立并删除 `ninda_restore_check_*` 临时库，不覆盖业务库；校验上传归档可读取。生产恢复不由脚本自动执行，须明确维护窗口和选定备份。配置/实名加密密钥与备份解密密钥需另行安全备份，且备份应有异机副本；同机备份不能抵御磁盘损毁。定时任务无旧业务数据清理操作。

TLS 每天北京时间 04:00 附近检查到期，续期成功才 reload Nginx；如 Ubuntu 同时已有 `certbot.timer`，可保留其默认检查，但应避免重复安装不同续期命令。支付商户凭据尚未齐全时不安装旧商户的证书刷新任务。

激活成功会保存受限的 `.env.active`。失败时恢复原 Nginx、静态链接、API 镜像，并在存在上次成功配置时恢复 `.env.active`；其支付文件路径仍指向保留的不可变旧文件，数据库迁移不逆向删除。主动回滚需选定之前的镜像与静态版本，保持数据库/实名密钥不变，将配置的 `API_IMAGE`、`BUILD_VERSION` 指向旧版本，再运行激活脚本。不要清理仍被当前配置、`.env.active` 或保留的回滚配置引用的支付文件。不得运行 `docker compose down -v`、删除 `ninda-prod-db` 或对旧服务器做任何部署/清理。

构建外网依赖为 Node/Debian/pnpm 包与字体；运行外网依赖为微信登录/手机号接口、微信支付接口（启用后）、法大大专属端点（启用后）、阿里云短信（启用后）、ACME 证书服务及 DNS。服务号 AppID 已记录不代表服务号 API 集成或菜单已配置。
