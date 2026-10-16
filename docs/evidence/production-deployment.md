# 正式环境部署核验

## 登录验收与短信配置修正（2026-10-16 14:25 CST）

- 微信一键手机号登录已由用户真机完成，独立库确认手机号/OpenID 绑定、正式协议同意及有效会话。
- 用户授权向同一手机号发送一次短信验证。开启 `PORTAL_SMS_ENABLED=true` 后，用户最初三次请求失败；只读诊断确认原 `.env` 的短信值含中文外围引号，导致 HTTP 请求头 ByteString 校验失败，尚未到达阿里云。
- 仅在新系统私有配置中去除配对外围引号，模板确认为用户指定的 `SMS_508385053`，其他配置保持不变；重建自有 API 容器，健康仍为 `ok / connected / 20261016-1320`。原项目配置未改动。
- 14:24:10 调用已部署的 `RealIdentityGateway.requestSms` 向该客户发送一次授权验证码，阿里云返回 HTTP 200 / `OK`。14:25:09 用户通过手机端 `/api/customer/auth/sms/login` 登录，访问日志 HTTP 201；数据库确认验证码 `CONSUMED`、首次尝试、同一客户与有效会话，订单仍为 0。
- 导入脚本新增中文外围引号规范化及格式检查，12 项新增回归与12项原配置生成器测试均通过，独立审查无阻断项。运行镜像未改，修正只需更新配置。
- 下方初次审计保留当时快照；其中 `PORTAL_SMS_ENABLED=false` 及“短信未验证”仅描述当时状态。当前 SMS 已开启并验收通过，微信支付及法大大写入开关仍关闭。证据：`production-sms-send.json`、`production-sms-login.json`。

## 主控后续核验（2026-10-16 13:51–13:54 CST）

- 主控独立读取 backup 与 pay-certificates 的 systemd 结果：均 `Result=success / ExecMainStatus=0`，有实际开始和结束时间；运行中 API 的 `FADADA_ENABLED` 与 `FADADA_SIGNING_ENABLED` 均为 `false`。
- 实际启动 `chundian-tls.service`，13:51:56–13:51:58 成功退出 0。Lego 检查证书剩余 89 天，按 30 天阈值正常跳过签发；Nginx 配置检查和 reload 成功。此证据验证定时任务执行链路，不代表已执行到期后的重新签发。
- 六份传输归档（1300/1320 API 和 admin 包、Node 基础镜像包、Lego 安装包）与本地保留副本 SHA-256 完全一致；两版 API 镜像、Node 镜像与 Lego 可执行文件已验证存在。仅删除新项目根目录下这六份重复传输归档，共约 777 MiB，未删除运行镜像、回滚发布目录、业务数据、备份或旧项目文件。
- 清理后磁盘可用 4.5 GiB、使用率 89%；HTTPS health 仍返回 `ok / connected / 20261016-1320`。容量余量仍需持续管理，异机备份与容量告警接收安排尚待完成。

以下保留独立审计的时间点和首次维护细节，资源快照可能早于上述清理。

初次核验时间：2026-10-16 05:35–05:37 UTC（北京时间 13:35–13:37）。初次核验方式为独立只读 SSH、HTTPS 请求、容器与 systemd 状态读取、脚本语法检查及备份校验和检查。随后经主控明确授权，于 05:38 UTC 首次启动自有证书刷新与备份服务；执行范围与结果见文末。未部署或重启业务服务，未发送短信、创建支付或发起签章。

## 当前版本与 HTTPS

| 项目 | 实测结果 |
| --- | --- |
| API | `https://mini-api.subauto.keybox.cloud/api/health` 返回 HTTP 200；curl TLS 验证结果为 0 |
| Health 内容 | `{"status":"ok","database":"connected","version":"20261016-1320"}` |
| 后台 | `https://mini-admin.subauto.keybox.cloud/` 返回 HTTP/2 200 |
| 发布目录 | `current` 指向 `/opt/wechat-miniapp-sub/releases/20261016-1320` |
| API 镜像 | `chundian-api:20261016-1320` |
| 镜像内容 ID | `sha256:0e9e855f905795c88d8dfde1948b789c40b6ae51ec98faa617bebd6629c32b8f` |
| TLS 有效期 | 2026-10-16 03:10:06 UTC 至 2027-01-14 03:10:05 UTC |
| 证书 SAN | `mini-admin.subauto.keybox.cloud`、`mini-api.subauto.keybox.cloud` |

后台响应包含 HSTS、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer` 和限制连接至独立 API 的 CSP；首页为 `Cache-Control: no-cache`。

## 容器隔离与资源快照

| 项目 | API | PostgreSQL |
| --- | --- | --- |
| 容器 | `chundian-prod-api-1` | `chundian-prod-db-1` |
| 状态 | running / healthy | running / healthy |
| 主机端口 | 仅 `127.0.0.1:13101 → 3101/tcp` | `5432/tcp` 未发布到主机 |
| 内存限制 | 384 MiB | 256 MiB |
| 快照内存 | 101.1 MiB | 52.86 MiB |
| 快照 CPU | 0.01% | 0.00% |
| 存储 | 独立 uploads 可写，secrets 只读挂载 | 独立 `chundian-prod-db` Docker 卷 |

API 以 `node` 用户运行，根文件系统只读。生产配置文件权限为 `0600 root:root`，密钥目录 `0750 root:1000`，uploads 为 `0750 1000:1000`，备份目录为 `0700 root:root`。未读取或记录凭据值。

主机内存共 1870 MiB、available 990 MiB；swap 共 4096 MiB、已用 405 MiB。根磁盘共 40 GiB、已用 34 GiB、可用 3.8 GiB，使用率 **91%**。这是空闲时瞬时读数，不构成负载测试；磁盘余量应在交接时安排处理，并为备份、镜像更新及上传增长预留空间。

## 备份、恢复与定时任务

独立读取发现加密备份及配套 SHA-256 文件存在。以下两份 `sha256sum --check` 均退出 0、结果为 OK：

- `20261016T050712Z.tar.enc`：92,192 字节。
- `20261016T052027Z.tar.enc`：112,672 字节。

**主控执行证据**：主控报告已对 `20261016T050712Z` 执行隔离临时数据库恢复检查，成功恢复并统计 **33 张表**。本轮独立核验只验证备份文件存在及校验和，不重复执行恢复，也不将主控结果表述为本轮亲自执行的恢复。

| systemd 定时器 | 状态 | 下次执行（服务器 CST / UTC+8） | 本轮首次执行证据 |
| --- | --- | --- | --- |
| `chundian-backup.timer` | enabled / active / waiting | 2026-10-17 03:31:01 | LastTrigger 为空；service 无开始/结束时间；journal 无记录 |
| `chundian-tls.timer` | enabled / active / waiting | 2026-10-17 04:11:14 | 同上 |
| `chundian-pay-certificates.timer` | enabled / active / waiting | 2026-10-17 04:30:38 | 同上 |

初次只读检查时，三个 service 均已加载、为 inactive/dead。其默认 `Result=success` 与 `ExecMainStatus=0` **不能证明执行成功**，因为启动时间为空且 journal 没有记录。下文补充经授权执行的首次任务结果；TLS 续期 service 仍未在本轮启动。

服务器实际 `/opt/wechat-miniapp-sub/deploy/` 下 `backup.sh`、`maintenance.sh`、`verify-backup.sh`、`issue-tls.sh` 全部通过 `bash -n`（退出 0）；证书刷新脚本文件存在。备份 service 使用 `ExecStartPost` 在备份成功后执行 maintenance，事务内仅清理过期超过 30 天的短信挑战、客户会话与管理员会话。该配置已核对，维护动作本轮未执行。

证书刷新 service 使用只读根文件系统的固定 Node 24.21.0 容器，配置与脚本只读挂载、证书目录可写，任务用于刷新微信支付验签证书。它不创建支付，但会更新证书文件，因此本轮未运行。

## 第三方能力边界与交接

直接读取运行中 API 的非敏感开关确认：`PORTAL_SMS_ENABLED=false`、`WECHAT_PAY_ENABLED=false`、`FADADA_ENABLED=false`、`FADADA_SIGNING_ENABLED=false`、`FADADA_ACCOUNT_REGISTER_ENABLED=false`、`FADADA_REALNAME_VERIFY_ENABLED=false`。其中实际控制签署的是 `FADADA_SIGNING_ENABLED`；旧的 `FADADA_AUTO_SIGN_ENABLED` 不参与运行判断。

当前证据确认基础正式环境已运行，**不代表完成真实短信、支付、退款、实名或电子签章联调**。这些能力的真实端到端验证与开关开启须由主控按获准范围另行执行。

首次检查时提出的交接命令（后续已获授权执行其中两个 `systemctl start`，结果见下文）：

```sh
systemctl start chundian-pay-certificates.service
systemctl show chundian-pay-certificates.service -p Result -p ExecMainStatus -p ExecMainStartTimestamp -p ExecMainExitTimestamp
journalctl -u chundian-pay-certificates.service --no-pager -n 30

systemctl start chundian-backup.service
systemctl show chundian-backup.service -p Result -p ExecMainStatus -p ExecMainStartTimestamp -p ExecMainExitTimestamp
journalctl -u chundian-backup.service --no-pager -n 30
```

备份 service 同时执行维护清理，须由主控知悉其作用后运行。证书刷新应确认原子写入成功、API 仍可读取证书；备份任务应确认新增归档、校验和、维护事务及 service 的完成时间。随后关注首个自动触发结果，并制定磁盘余量、备份外部副本和告警接收安排。日志交接须脱敏，不复制生产配置或密钥内容。

## 经授权的首次服务执行（05:38 UTC）

执行前重新读取服务器上两个 service 及对应 `refresh-wechat-certificates.mjs`、`backup.sh`、`maintenance.sh`，确认其使用独立配置、数据库和上传目录。仅启动 `chundian-pay-certificates.service` 与 `chundian-backup.service`；未改变业务开关。

| 任务 | 实际结果 |
| --- | --- |
| 证书刷新 | 13:38:42–13:38:43 CST，`Result=exit-code`、`ExecMainStatus=125`。Docker 在创建默认 bridge 端点时失败：`docker0` 设备不存在。脚本尚未运行，未调用微信证书下载接口，也未更新证书。 |
| 加密备份 | 13:38:43–13:38:44 CST，`Result=success`、`ExecMainStatus=0`。产生 `20261016T053843Z.tar.enc`，独立执行 SHA-256 校验结果 OK、退出 0。 |
| 备份后维护 | 同一 service 的 `ExecStartPost` 执行 `BEGIN`、三项 `DELETE 0`、`COMMIT`。维护正常完成，本次没有符合清理条件的记录。 |

证书失败的只读诊断：`ip link show docker0` 返回设备不存在；Docker 仍列出逻辑默认 `bridge` 网络。独立项目的 `chundian-prod_default` 存在，API 当前加入该网络。主控随后明确授权仅给本项目证书刷新 service 的 `docker run` 增加 `--network chundian-prod_default`。已同步修改仓库 `deploy/chundian-pay-certificates.service` 和服务器 `/etc/systemd/system/chundian-pay-certificates.service`，执行 `systemctl daemon-reload` 后重试；未修改宿主默认网桥或其他项目网络。

修复后于 **13:41:56–13:41:57 CST** 成功执行，`Result=success`、`ExecMainStatus=0`。任务输出 `certificateCount=1`、`responseVerified=true`、`updated=true`，说明下载响应验签通过并完成证书写入。随后以运行中 API 的 `node` 用户在容器内读取证书成功，修改时间为 `2026-10-16T05:41:57.434Z`、权限仍为 `0640 root:1000`，有效期与指纹如下。备份与证书刷新 timer 均仍 active；新的备份再次校验通过，HTTPS health 仍正常。首个定时自动触发结果仍应在次日复查；本段验证的是实际 systemd service 手动启动链路。

原有微信验签证书仍可读取，有效期为 2026-06-18 08:01:38 UTC 至 2031-06-17 08:01:38 UTC，权限 `0640 root:1000`。其 SHA-256 指纹为 `50:03:1C:1B:A7:48:F7:E0:AD:3F:EC:40:47:9D:17:B5:E6:0A:40:4D:B3:72:74:CE:21:A8:62:E0:B4:84:9F:C2`。服务执行后 HTTPS health 仍返回版本 `20261016-1320`、数据库 connected，API 容器仍 healthy。

## 磁盘只读分析与可清理候选

独立项目目录总占用约 840 MiB，其中 backups 552 KiB、uploads 4 KiB、两个后台 release 目录合计 688 KiB、lego 解压后工具目录 62 MiB。主体占用来自已传输归档：

| 自有传输归档（位于 `/opt/wechat-miniapp-sub/`） | 大小 |
| --- | --- |
| `chundian-api-20261016-1300.tar.gz` | 279,890,256 字节 |
| `chundian-api-20261016-1320.tar.gz` | 279,891,331 字节 |
| `node24-base.tar` | 235,302,400 字节 |
| `lego.tar.gz` | 19,232,422 字节 |
| `admin-20261016-1300.tar.gz` | 101,810 字节 |
| `admin-20261016-1320.tar.gz` | 102,399 字节 |

这六项合计约 **777 MiB**。已确认两版本 API 镜像及 Node 24.21.0 镜像均已导入，两个后台 release 目录存在，`bin/lego` 可执行。主控仍需核对归档 SHA 和本地交付副本，确认回滚镜像保留后，才按精确文件名清理。它们是传输归档，不包含数据库备份；本轮没有删除任何文件，也不建议执行全局 Docker prune。清理这些归档只能部分缓解 91% 的磁盘占用。`docker system df` 的只读统计在 40 秒超时后结束，根目录分层 `du` 在 30 秒超时后结束；未据此推断可回收的 Docker 空间或其他项目空间。自有目录的统计已完整返回。
