# 独立纯电主义生产部署

仅操作 `139.196.227.195:/opt/wechat-miniapp-sub`、`chundian-prod` Compose 项目和 `chundian_prod` 数据库。旧系统保持不动。

1. 按下方配置说明准备 `.env.providers.local`，本地执行 `node scripts/prepare-production-config.mjs --release=<唯一版本>` 生成或复用独立凭据，输出位于 `.runtime/production`。私有配置及该目录均不提交；仅提交不含真实凭据的 `*.example` 模板。不要删除并重建已投入使用的数据库密码或实名资料加密密钥。
2. `docker build --build-arg DEBIAN_MIRROR=http://mirrors.tuna.tsinghua.edu.cn -f deploy/Dockerfile.api -t chundian-api:<唯一版本> .`。官方 Debian 软件仓库在本次网络中返回 502，使用已核验的 TUNA 镜像，APT 仍验证 Debian 签名。运行镜像包含 OpenSSL 3 和 Noto CJK 字体。
3. 以 `VITE_API_BASE_URL=https://mini-api.subauto.keybox.cloud/api` 构建 `apps/admin`。上传静态产物至 `releases/<唯一版本>/admin`，加载对应 Docker 镜像并在私有生产配置中设置 `API_IMAGE` 和 `BUILD_VERSION`。
4. 私有配置权限 `600`；secrets 目录 `root:1000 / 750`，API 需读取的 PEM 文件 `root:1000 / 640`；uploads 为 `1000:1000 / 750`。API 以 uid 1000 运行，文件系统只读，仅 uploads 和临时目录可写。
5. 首次部署先运行 `prepare-host.sh` 安装两个新域名的 HTTP 验证入口，再运行 `issue-tls.sh` 申请证书。初始 HTTP 脚本拒绝覆盖已切换为生产 HTTPS 的配置。
6. `bash deploy/activate-release.sh <版本>` 依次启动独立数据库、加密备份、迁移、启动 API、核验健康、切换静态链接和 Nginx 配置。失败会恢复原静态链接、Nginx 配置及 API 镜像；数据库迁移不自动逆向执行。迁移须保持向后兼容；非兼容恢复需维护窗口和明确选定备份。
7. 首次管理员：`docker compose --env-file .env.production -f deploy/compose.production.yml run --rm --no-deps api node dist/auth/bootstrap.js`，已有管理员会拒绝覆盖。引导凭据来自私有配置，不粘贴到日志或聊天。管理员创建后应在受控渠道交接凭据。
8. 在本机运行 `node scripts/publish-approved-legal.mjs`，它校验用户已批准的文件 SHA-256，再经正式管理 API 发布五种文案（主合同与费用附件合并），并核对公开读取内容。不能跳过审定状态和版本冲突。

API 只绑定 `127.0.0.1:13101`，数据库不暴露主机端口。公网仅由 Nginx 的 HTTPS 入口提供服务。

微信业务域名的本方回跳页位于 `mini-api.subauto.keybox.cloud`。管理员下载的 `G1wS8MuuaR.txt` 原样放入独立的 `wechat-domain-verification/` 目录，Nginx 仅公开该精确文件路径；文件内容不提交仓库。上线前核对 HTTPS 返回字节与原文件一致。提供校验文件不等于微信平台已完成业务域名登记；法大大自己的页面域名还需由法大大部署同一校验文件并给出可登记域名。

## 配置文件与实际读取关系

| 文件 | 用途与加载方式 |
| --- | --- |
| 根 `.env.example` → `.env` | 本地 API 自动读取根 `.env`；独立数据库使用 `DATABASE_URL`，测试另用 `TEST_DATABASE_URL`。`UPLOAD_DIR` 是实际上传目录变量；相对路径以进程工作目录解析。 |
| 根 `.env.providers.example` → `.env.providers.local` | 供应商导入、只读预检、生产配置生成器读取；API 不自动读取此文件。本地联调需把所需字段提供给 API 进程环境或根 `.env`。 |
| `.runtime/production/.env.production` | 生成器输出；部署时复制到独立项目根 `.env.production`。Compose 的 `--env-file` 用于镜像等插值，API 的 `env_file` 将配置注入容器。 |
| `apps/admin/.env.example` | 仅公开的 `VITE_API_BASE_URL`；生产构建指定新 API 的 HTTPS 根地址。修改后需要重新构建静态产物。 |
| 根 `.env.miniapp.example` → `.env.miniapp.local` | `scripts/miniapp-ci.mjs` 读取 `WECHAT_UPLOAD_PRIVATE_KEY_PATH`；AppID 来自构建包的 `project.config.json`。上传密钥不进入小程序包。 |
| `apps/miniprogram/src/config.js` | 小程序公开 API 地址与经核验的 `signingHosts`；不是服务端环境变量，不放任何密钥。 |

现有 `.gitignore` 的 `!.env.example` 与 `!.env.*.example` 允许提交模板，实际 `.env`、`.env.*.local`、`.runtime/`、PEM/KEY 文件仍被忽略。供应商示例使用每行 `KEY="JSON字符串"`，保持与证书维护脚本的解析方式兼容；填写私有文件时不要加入注释、空行、未加引号的值，路径使用正斜杠。空值是待配置占位，不表示供应商已经接通。

### 供应商字段

- 微信身份：`WECHAT_MINIPROGRAM_APP_ID` 与 `WECHAT_MINIPROGRAM_APP_SECRET`。AppID 应与小程序构建配置一致。
- 短信：`PORTAL_SMS_ENABLED`，以及 `ALIYUN_SMS_ACCESS_KEY_ID`、`ALIYUN_SMS_ACCESS_KEY_SECRET`、`ALIYUN_SMS_SIGN_NAME`、`ALIYUN_SMS_LOGIN_TEMPLATE_CODE`、`ALIYUN_SMS_TEMPLATE_CODE_VARIABLE`。当前实现固定请求阿里云短信官方端点，不读取旧的 endpoint 配置。
- 支付：`WECHAT_PAY_ENABLED`、`WECHAT_PAY_MCH_ID`、`WECHAT_PAY_MERCHANT_SERIAL_NO`、`WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH`、`WECHAT_PAY_API_V3_KEY`。证书模式填写 `WECHAT_PAY_PLATFORM_CERT_PATH`；公钥模式另填 `WECHAT_PAY_PUBLIC_KEY_ID` 与 `WECHAT_PAY_PUBLIC_KEY_PATH`。`WECHAT_PAY_NOTIFY_URL` 必须为 `https://mini-api.subauto.keybox.cloud/api/callbacks/wechat-pay`，`WECHAT_PAY_REFUND_NOTIFY_URL` 必须为同域 `/api/callbacks/wechat-refund`，不得沿用旧系统回调。
- 1 分钱渠道验收使用独立的 `WECHAT_PAY_VERIFICATION_ENABLED`（默认 `false`），以及 `WECHAT_PAY_VERIFICATION_NOTIFY_URL=https://mini-api.subauto.keybox.cloud/api/callbacks/wechat-pay-verification`。该入口仅允许 ADMIN 为指定既有客户建立授权记录，金额固定为人民币1分，客户仍须亲自确认微信付款；不会开启普通支付、创建租赁订单或修改正式报价。验收记录使用独立表及回调，成功后不得再次向同客户收取验收款。配置生成器保留本系统已明确设置的开关，忽略供应商输入中的启用值；不得沿用普通支付回调处理验收款。退款不在本轮入口中执行。
- 法大大：`FADADA_BASE_URL`、`FADADA_ENV`、`FADADA_API_VERSION`、`FADADA_APP_ID`、`FADADA_APP_SECRET`、`FADADA_PLATFORM_CUSTOMER_ID`、`FADADA_PLATFORM_SIGNATURE_ID`；地址与账号支持的协议版本须核验。请求超时、签署链接数量与有效期分别为 `FADADA_REQUEST_TIMEOUT_MS`、`FADADA_SIGN_URL_QUANTITY`、`FADADA_SIGN_URL_VALIDITY_MINUTES`。
- 法大大实际功能开关为 `FADADA_ENABLED`、`FADADA_ACCOUNT_REGISTER_ENABLED`、`FADADA_REALNAME_VERIFY_ENABLED`、`FADADA_SIGNING_ENABLED`，全部默认关闭。旧导入配置可能含 `FADADA_AUTO_SIGN_ENABLED`，但它不是当前签署开关；不得依赖它判断是否允许签章。
- 法大大通知使用 `FADADA_SIGN_NOTIFY_URL`、`FADADA_VERIFY_NOTIFY_URL`，分别为新 API 的 `/api/callbacks/fadada-sign`、`/api/callbacks/fadada-identity`。`FADADA_SIGN_RETURN_URL`、`FADADA_VERIFY_RETURN_URL` 可留空以采用新 API `/api/public/esign-return` 默认页；用户返回该页不等于业务已成功。

### 生成、路径转换与保留

生成器从已有 `.runtime/production/.env.production` 保留数据库密码、JWT/会话密钥、管理员引导凭据、实名加密密钥及功能开关；其他供应商字段以 `.env.providers.local` 为来源。指定 `--release` 同时设置 `API_IMAGE` 和 `BUILD_VERSION`。只在服务器手工修改的供应商字段不会自动回流到本地；生成新配置前须在受控渠道同步，不能用旧导入文件覆盖已经轮换的凭据。

`ESIGN_IDENTITY_ENCRYPTION_KEY` 由生产生成器建立或复用，必须是32字节随机数据的Base64编码；不要在供应商输入文件中用空值覆盖它。该密钥需单独备份，已有实名密文后不能随意换值。生产 Docker 镜像已设置 `FADADA_CJK_FONT_PATH=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`，供应商输入文件不要设置空值或Windows字体路径来覆盖它。

三个 PEM 路径字段在供应商输入文件中填写本机可读的绝对路径：`WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH`、`WECHAT_PAY_PLATFORM_CERT_PATH`、`WECHAT_PAY_PUBLIC_KEY_PATH`。生成器把文件复制到 `.runtime/production/secrets`，并改写成容器路径 `/run/chundian-secrets/<文件名>`；文件名必须互不相同。生产当前仅支持 `WECHAT_PAY_PLATFORM_CERT_PATH` 指向**一个包含多张证书的PEM集合文件**，不支持分号路径列表 `WECHAT_PAY_PLATFORM_CERT_PATHS`。若输入出现后者，应停止生成/部署并先转换为单文件，不能忽略它继续发布。证书刷新任务也仅更新这个单文件。

Compose 将上传目录固定为 `/app/uploads` 并挂载项目 `uploads/`，将 `HOST` 固定为 `0.0.0.0`、`PORT` 固定为 `3101`，外部仍只暴露本机转发端口。`ADMIN_ORIGIN` 控制实际后台来源与CORS，`JWT_SECRET`、`SESSION_SECRET` 是当前生产校验必填项。旧变量 `LOCAL_FILE_STORAGE_DIR`、`CORS_ORIGIN`、`API_BASE_URL`、`APP_ENV`、`ESIGN_PROVIDER` 不作为当前 API 的对应配置入口；小程序和后台地址分别在各自上述配置中设置。

上传/预览命令读取 `.env.miniapp.local`；需先安装现有脚本使用的工具环境（`npm install --prefix .runtime/miniapp-tools --no-audit --no-fund miniprogram-ci@2.1.31 miniprogram-automator@0.13.0`）并构建生产包。工具位于忽略目录，不随客户端发版。随后 `node scripts/miniapp-ci.mjs preview` 或 `node scripts/miniapp-ci.mjs upload <版本号>`。代码上传只是开发版本上传，仍需完成微信平台审核和正式发布；上传前核对代码上传权限、密钥及平台要求的来源IP。已登录的官方开发者工具 CLI 也可用于预览与上传。

## 备份、恢复与续期

`backup.sh` 生成 PostgreSQL 自定义格式备份及上传目录归档，以独立备份密钥加密，保存摘要，超过 30 天轮换。密钥在 `secrets/backup.key`，需与备份分开保存；当前同机备份不能抵御整机或磁盘损毁。

`bash deploy/verify-backup.sh /opt/wechat-miniapp-sub/backups/<时间>.tar.enc` 验证摘要、解密、检查文件归档，并恢复到专用 `chundian_restore_check_<时间>` 临时数据库后删除该临时库。它不覆盖生产库。

安装 `chundian-backup`、`chundian-tls`、`chundian-pay-certificates` 的 service/timer 至 `/etc/systemd/system`，执行 `systemctl daemon-reload` 和 `systemctl enable --now <名称>.timer`。备份后仅清理失效满 30 天的短信校验与会话；其他业务记录和文件按隐私政策人工审核删除。`logrotate.conf` 安装为独立 `/etc/logrotate.d/chundian-mini`，安全访问日志保留 190 天，日志格式不记录 URL 查询参数。

微信支付证书刷新脚本先验证 HTTPS 和 APIv3 AES-GCM 认证加密，再用取得的证书验证整份响应签名，最后原子替换证书文件；失败不覆盖已有证书。供应商开关必须在对应真实验收条件满足后开启；支付成功、签署成功均由服务端核验，不能由前端页面返回代替。

## 回滚

查 `releases/` 和 Docker 已保留的镜像，选定上一个已验证版本；将私有配置的 `API_IMAGE` / `BUILD_VERSION` 恢复为对应值，再运行 `activate-release.sh <旧版本>`。不得使用 `docker compose down -v`，不得删除 `chundian-prod-db`，不得对旧系统容器或目录执行清理。
