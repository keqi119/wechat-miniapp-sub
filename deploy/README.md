# 独立纯电主义生产部署

仅操作 `139.196.227.195:/opt/wechat-miniapp-sub`、`chundian-prod` Compose 项目和 `chundian_prod` 数据库。旧业务数据库与原门户路由保持不动；服务号 H5 签约按下文只在既有 app 主机追加独立路径。

1. 按下方配置说明准备 `.env.providers.local`，本地执行 `node scripts/prepare-production-config.mjs --release=<唯一版本>` 生成或复用独立凭据，输出位于 `.runtime/production`。私有配置及该目录均不提交；仅提交不含真实凭据的 `*.example` 模板。不要删除并重建已投入使用的数据库密码或实名资料加密密钥。
2. `docker build --build-arg DEBIAN_MIRROR=http://mirrors.tuna.tsinghua.edu.cn -f deploy/Dockerfile.api -t chundian-api:<唯一版本> .`。官方 Debian 软件仓库在本次网络中返回 502，使用已核验的 TUNA 镜像，APT 仍验证 Debian 签名。运行镜像包含 OpenSSL 3 和 Noto CJK 字体。
3. 以 `VITE_API_BASE_URL=https://mini-api.subauto.keybox.cloud/api` 构建 `apps/admin`。上传静态产物至 `releases/<唯一版本>/admin`，加载对应 Docker 镜像并在私有生产配置中设置 `API_IMAGE` 和 `BUILD_VERSION`。
4. 私有配置权限 `600`；secrets 目录 `root:1000 / 750`，API 需读取的 PEM 文件 `root:1000 / 640`；uploads 为 `1000:1000 / 750`。API 以 uid 1000 运行，文件系统只读，仅 uploads 和临时目录可写。
5. 首次部署先运行 `prepare-host.sh` 安装两个新域名的 HTTP 验证入口，再运行 `issue-tls.sh` 申请证书。初始 HTTP 脚本拒绝覆盖已切换为生产 HTTPS 的配置。
6. `bash deploy/activate-release.sh <版本>` 依次启动独立数据库、加密备份、迁移、启动 API、核验健康、切换静态链接和 Nginx 配置。失败会恢复原静态链接、Nginx 配置及 API 镜像；数据库迁移不自动逆向执行。迁移须保持向后兼容；非兼容恢复需维护窗口和明确选定备份。
7. 首次管理员：`docker compose --env-file .env.production -f deploy/compose.production.yml run --rm --no-deps api node dist/auth/bootstrap.js`，已有管理员会拒绝覆盖。引导凭据来自私有配置，不粘贴到日志或聊天。管理员创建后应在受控渠道交接凭据。
8. 在本机运行 `node scripts/publish-approved-legal.mjs`，它校验用户已批准的文件 SHA-256，再经正式管理 API 发布五种文案（主合同与费用附件合并），并核对公开读取内容。不能跳过审定状态和版本冲突。

API 只绑定 `127.0.0.1:13101`，数据库不暴露主机端口。公网仅由 Nginx 的 HTTPS 入口提供服务。

微信业务域名的本方回跳页位于 `mini-api.subauto.keybox.cloud`。管理员下载的 `G1wS8MuuaR.txt` 原样放入独立的 `wechat-domain-verification/` 目录，Nginx 仅公开该精确文件路径；文件内容不提交仓库。上线前核对 HTTPS 返回字节与原文件一致。提供校验文件不等于微信平台已完成业务域名登记；该内嵌方案现已被用户选择的服务号 H5 方案替代，不再以供应商补域名为施工前置。

## 配置文件与实际读取关系

| 文件 | 用途与加载方式 |
| --- | --- |
| 根 `.env.example` → `.env` | 本地 API 自动读取根 `.env`；独立数据库使用 `DATABASE_URL`，测试另用 `TEST_DATABASE_URL`。`UPLOAD_DIR` 是实际上传目录变量；相对路径以进程工作目录解析。 |
| 根 `.env.providers.example` → `.env.providers.local` | 供应商导入、只读预检、生产配置生成器读取；API 不自动读取此文件。本地联调需把所需字段提供给 API 进程环境或根 `.env`。 |
| `.runtime/production/.env.production` | 生成器输出；部署时复制到独立项目根 `.env.production`。Compose 的 `--env-file` 用于镜像等插值，API 的 `env_file` 将配置注入容器。 |
| `apps/admin/.env.example` | 仅公开的 `VITE_API_BASE_URL`；生产构建指定新 API 的 HTTPS 根地址。修改后需要重新构建静态产物。 |
| 根 `.env.miniapp.example` → `.env.miniapp.local` | `scripts/miniapp-ci.mjs` 读取 `WECHAT_UPLOAD_PRIVATE_KEY_PATH`；AppID 来自构建包的 `project.config.json`。上传密钥不进入小程序包。 |
| `apps/miniprogram/src/config.js` | 小程序公开 API 地址；签约入口通过新 API 的公开配置读取；不是服务端环境变量，不放任何密钥。 |

现有 `.gitignore` 的 `!.env.example` 与 `!.env.*.example` 允许提交模板，实际 `.env`、`.env.*.local`、`.runtime/`、PEM/KEY 文件仍被忽略。供应商示例使用每行 `KEY="JSON字符串"`，保持与证书维护脚本的解析方式兼容；填写私有文件时不要加入注释、空行、未加引号的值，路径使用正斜杠。空值是待配置占位，不表示供应商已经接通。

### 供应商字段

- 微信身份：`WECHAT_MINIPROGRAM_APP_ID` 与 `WECHAT_MINIPROGRAM_APP_SECRET`。AppID 应与小程序构建配置一致。
- 短信：`PORTAL_SMS_ENABLED`，以及 `ALIYUN_SMS_ACCESS_KEY_ID`、`ALIYUN_SMS_ACCESS_KEY_SECRET`、`ALIYUN_SMS_SIGN_NAME`、`ALIYUN_SMS_LOGIN_TEMPLATE_CODE`、`ALIYUN_SMS_TEMPLATE_CODE_VARIABLE`。当前实现固定请求阿里云短信官方端点，不读取旧的 endpoint 配置。
- 支付：`WECHAT_PAY_ENABLED`、`WECHAT_PAY_MCH_ID`、`WECHAT_PAY_MERCHANT_SERIAL_NO`、`WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH`、`WECHAT_PAY_API_V3_KEY`。证书模式填写 `WECHAT_PAY_PLATFORM_CERT_PATH`；公钥模式另填 `WECHAT_PAY_PUBLIC_KEY_ID` 与 `WECHAT_PAY_PUBLIC_KEY_PATH`。`WECHAT_PAY_NOTIFY_URL` 必须为 `https://mini-api.subauto.keybox.cloud/api/callbacks/wechat-pay`，`WECHAT_PAY_REFUND_NOTIFY_URL` 必须为同域 `/api/callbacks/wechat-refund`，不得沿用旧系统回调。
- 1 分钱渠道验收使用独立的 `WECHAT_PAY_VERIFICATION_ENABLED`（默认 `false`），以及 `WECHAT_PAY_VERIFICATION_NOTIFY_URL=https://mini-api.subauto.keybox.cloud/api/callbacks/wechat-pay-verification`。该入口仅允许 ADMIN 为指定既有客户建立授权记录，金额固定为人民币1分，客户仍须亲自确认微信付款；不会开启普通支付、创建租赁订单或修改正式报价。验收记录使用独立表及回调，成功后不得再次向同客户收取验收款。配置生成器保留本系统已明确设置的开关，忽略供应商输入中的启用值；不得沿用普通支付回调处理验收款。退款不在本轮入口中执行。
- 法大大：`FADADA_BASE_URL`、`FADADA_ENV`、`FADADA_API_VERSION`、`FADADA_APP_ID`、`FADADA_APP_SECRET`、`FADADA_PLATFORM_CUSTOMER_ID`、`FADADA_PLATFORM_SIGNATURE_ID`；地址与账号支持的协议版本须核验。请求超时、签署链接数量与有效期分别为 `FADADA_REQUEST_TIMEOUT_MS`、`FADADA_SIGN_URL_QUANTITY`、`FADADA_SIGN_URL_VALIDITY_MINUTES`。
- 法大大实际功能开关为 `FADADA_ENABLED`、`FADADA_ACCOUNT_REGISTER_ENABLED`、`FADADA_REALNAME_VERIFY_ENABLED`、`FADADA_SIGNING_ENABLED`，全部默认关闭。旧导入配置可能含 `FADADA_AUTO_SIGN_ENABLED`，但它不是当前签署开关；不得依赖它判断是否允许签章。
- 法大大通知使用 `FADADA_SIGN_NOTIFY_URL`、`FADADA_VERIFY_NOTIFY_URL`，分别为新 API 的 `/api/callbacks/fadada-sign`、`/api/callbacks/fadada-identity`。`FADADA_SIGN_RETURN_URL`、`FADADA_VERIFY_RETURN_URL` 在原生主流程固定为 `https://mini-api.subauto.keybox.cloud/api/public/esign-return`（独立 H5 备用流程显式使用 `https://app.subauto.keybox.cloud/miniapp-sign/return/`），不沿用旧门户合同页；用户返回该页不等于业务已成功。

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

## 服务号 H5 独立签约备用路径（默认关闭）

构建 `pnpm --filter @chundian/signing-h5 build`，把产物放入同一已验证版本的 `releases/<版本>/signing-h5`。仅根页 `/miniapp-sign/`、返回页 `/miniapp-sign/return/`、静态 `assets/` 和专属 `api/` 路径可用；未知页面404，不回退旧 Next。新 API 实际命名空间 `/api/h5-sign/`，数据只在独立数据库。不要改旧服务号 OAuth、菜单或客户 Cookie。

将四份 `nginx-signing-h5*.conf` 上传独立deploy目录；先以独立临时 Nginx 配置运行 `nginx -t`，不能直接覆盖旧host。新API及静态版本激活后，读取既有 app vhost 原始SHA，执行 `python3 deploy/activate-signing-route.py --release <版本> --expected-vhost-sha256 <刚核对的SHA>`。该脚本备份原文件，只增加一条精确include；新增HTTP级日志/限流配置先于host加载。语法、根页/返回页、专属API401、未知路径404和旧登录页200未通过时恢复原host与全局include。后续升级沿用已存在的include，不再次插入；正常版本切换仍须同时提供admin和signing-h5目录。

`H5_SIGNING_ENABLED`只控制备用入口可用性，默认false；小程序网页实名与签署由独立 `MINIAPP_SIGNING_ENABLED` 控制，两个入口不自动互相回退。`H5_SIGNING_PROVIDER_HOSTS`的两个批准首跳是`textapi.fadada.com,realnameverify.fadada.com`，依据旧H5真实接口结果核对；不要填泛域或外部任意URL。生产生成器保留本系统入口开关/允许列表，忽略旧输入中可能的启用值，原生返回固定 mini-api 公共页，H5 内部显式固定 H5 返回页。实名、签署分别受原供应商开关与真实业务准备度控制；网页可访问不代表已经完成真实签署。

独立cookie为`h5_signing_session`，8小时、HttpOnly/Secure/SameSite=Lax、Path=/miniapp-sign/。代理仅转该cookie并移除Authorization，写请求还校验Origin及CSRF。原系统与新H5同host，Cookie路径不是浏览器同源XSS隔离。新日志只记录URI无query，纳入现有190天logrotate；失效满30天的H5会话纳入maintenance。

迁移015和016应用后，运行 `node scripts/publish-approved-delivery-delay-legal.mjs <已验证的H5版本>` 发布已经批准的补充协议模板，公开读取须与批准SHA一致；模板批准不代表逐单报价已确认或签署。企业用印需实际授权和双人审批，客户按已启用的原生主入口自行实名认证及签署，状态查询读取同一新库。H5 仅在另行明确启用时作为备用，不要求客户经过旧系统 OAuth。

### 恢复小程序内签约（独立切片）

主入口 `GET /api/public/signing-config` 为 `MINIAPP_WEBVIEW`。`MINIAPP_SIGNING_ENABLED` 默认 false；`MINIAPP_SIGNING_PROVIDER_HOSTS` 默认空，完成业务域名核验后仅配置 `textapi17.fadada.com,realnameverify16.fadada.com`。`FADADA_BASE_URL` 为 `https://textapi17.fadada.com/api2/`；原生请求强制固定返回 `https://mini-api.subauto.keybox.cloud/api/public/esign-return`，通知仍新 API。默认端口 `:443` 也不允许出现在交客户端的 URL 中，验证后保留 URL 原字节。

`H5_SIGNING_ENABLED=false` 作为独立备用入口；它不决定小程序权限，也不会自动接管失败的原生操作。H5 显式调用仍使用其固定 `/miniapp-sign/return/`。供应商注册、实名、签署总开关及原企业审批继续独立守门。实名接口需要本次独立同意当前 privacy 的 id/version；关闭原生入口不关闭可信查询。刷脸小程序 AppID/path 与绑定 flow 尚未核实，因此 `faceBridgeConfigured=false`、允许列表空；不能据两首跳域名已核验宣称完整真机刷脸往返已通过。

默认 `verified_way=1` 保持“三要素补充”认证：手机号三要素通过直接成功，不通过才进入刷脸（法大大 API v2 官方发行文档第18页）。缺少刷脸 AppID/path/flow 不统一封死该默认分支，也不降低认证强度；提交前须明确告知转刷脸时当前无法继续，中间页拒绝未知参数。仅可在主控明确授权下验收真实手机号分支，未做真机刷脸往返时不能称完整实名闭环已验收。

官方5.1.3第4条要求通用返回地址替换为专属域名：仅原生实名结果将精确 `https://realnameverify.fadada.com/` authority 映射到 `https://realnameverify16.fadada.com/`，path/query保持原字节。其它来源不自动迁移；H5备用不套该规则。签署链接由专属API base直接构造，合同查看使用新库归档PDF。
