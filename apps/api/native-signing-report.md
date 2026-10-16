# 小程序内签约恢复：实现与验证

基线 d96ac7a；仅本隔离工作区，B2/017 保留原工作区，未纳入此切片。无新迁移。未调用真实实名、签署、短信或支付，未部署。

## 已实现

- public signing-config 为 MINIAPP_WEBVIEW；MINIAPP_SIGNING_ENABLED 默认 false，MINIAPP_SIGNING_PROVIDER_HOSTS 默认空，精确允许 textapi17.fadada.com / realnameverify16.fadada.com；API base 精确 textapi17/api2。未知 host 与任何显式端口（含443）、凭据、空白、片段拒绝，允许的短URL原字符串返回。按官方5.1.3第4条，仅原生实名结果将精确 `https://realnameverify.fadada.com/` 映射到 `https://realnameverify16.fadada.com/`，不改 path/query 字节，不映射签署/其它来源/H5备用。
- 原 customer Bearer 的 register/verify/refresh、主合同/交接/补充协议 sign 恢复到原状态机。开关或配置不完整在副作用前拒绝；查询入口保持可用；尾斜杠和路由大小写同样守门。
- verify 必须本次独立同意当前 privacy id/version；当前 terms/privacy 前置同意不替代本次选择。审计只记录文档 id/version/hash/source，不记录姓名或身份证。H5备用复用相同同意校验。
- 原生 return 强制 mini-api 公共返回页，不能由 Host/body/query 设置。原企业双人审批、文档hash、lease恢复、归属、可信查询和回调逻辑不变。
- 新 adapter 用 AsyncLocalStorage 区分原生调用，保持15固定源文件原字节。实名 is_mini_program=3 在摘要前加入；带坐标 extsign 使用 open_environment=4，原公式和坐标保留；不在未获文档支持的 extsign_validation 猜参数。H5备用不带这些原生参数。
- 当前没有可信刷脸小程序 AppID/path/flow，faceBridgeConfigured=false / []，不声称真机往返已通过。主控已核对法大大署名 API v2 发行文档第18页：verified_way=1 为“三要素补充”，手机号三要素通过即可成功，不通过才需刷脸。因此保留默认1，不因face缺项统一封闭所有创建，也不降低认证强度；原生须在提交前说明条件限制。官方来源 https://market-10039692.file.myqcloud.com/document/0/cb48fb0350d5c487f396d919a1f45fc7.pdf 。

## 最终证据

- 独立 pnpm install --frozen-lockfile 与独立 Prisma 6.19 generate 成功；未共享原工作区 node_modules。
- 新原生 HTTP 8项 + adapter 3项通过；先观察原H5-only拒绝/缺模块/错误API transport红，再实现。覆盖原生默认关闭、空/未知host、尾斜杠/大小写、归属/版本、独立同意、审批拒绝/lease释放、三kind固定return、伪成功查询、错误URL不泄露、默认verified_way=1及两微信参数摘要。
- 完整169项后新增官方要求的精确实名域名映射，观察502红后实现；末次受影响原生8 + adapter3 + H5 15 = 26/26通过，0失败，14409ms。未机械重复无关完整套件。
- 完整 API 第一次168项，166通过；2项文件下载因 worktree 位于 .codex 隐藏目录导致 Express sendFile 拒绝。未修改生产权限规则；设置独立非隐藏 UPLOAD_DIR=D:/wechat-miniapp-sub/var/native-signing-test-uploads 后对应 api.test.ts 11/11 通过。随后使用该独立测试路径运行最终完整套件：169/169通过，0失败，128987ms，exit0。
- 固定来源4个spec：51/51通过；manifest 15/15 SHA256一致。
- 末次映射修复后 pnpm --filter @chundian/api build 通过，git diff --check 无错误（原生代理文件有CRLF提示，非本实现改写）。

## 可复核命令

在本隔离 worktree 使用 PowerShell：

```powershell
pnpm install --frozen-lockfile
pnpm --filter @chundian/api prisma:generate
$env:NODE_ENV='test'
$env:UPLOAD_DIR='D:/wechat-miniapp-sub/var/native-signing-test-uploads'
pnpm --filter @chundian/api test
pnpm --filter @chundian/api exec tsx --test --test-concurrency=1 test/native-signing.test.ts test/native-fadada-adapter.test.ts test/h5-signing.test.ts
pnpm --filter @chundian/api build
pnpm exec vitest run apps/api/test/fadada-api-client.spec.ts apps/api/test/fadada-digest.spec.ts apps/api/test/enterprise-seal-policy.spec.ts apps/api/test/enterprise-seal-signing-plan.spec.ts --reporter=dot
```

完整测试输出保存在本地忽略文件 `.runtime-api-native-final.log`；末次映射受影响26项输出为 `.runtime-api-native-final-targeted.log`。额外直接将 API 默认关闭及启用但未配置两份DTO传入原生 `signingConfig` 实现，2/2正确消费（显示不可用，不抛契约解析错误）。以上数据库只使用新独立 test DB；不连接旧库、不操作生产。依赖/Prisma client 属于本 worktree，不覆盖暂停 B2 的017生成模型。

## 修改清单

新增 `src/esign/native-signing.ts`、`native-fadada-adapter.ts`、`realname-consent.ts` 与两项测试文件；修改 Access、ESign controller/module、H5 account/public-config controller、主合同/交接/订单变更控制器外层。旧 API/H5测试只调整默认入口契约预期。补非秘密 `.env.example`、`deploy/README.md`，根配置生成脚本由主控单独拥有。

没有数据库迁移、没有支付/报价/换车状态机改动。生产账号、密钥、实名值与短URL均不写入本报告。生产真实手机号三要素、刷脸条件分支及真实签章仍须按主控明确授权验收；本地合成通过不代表真实渠道验收完成。

## 独立复核

原生代理只读审查确认原状态/审批/lease保留、ALS渠道隔离与参数注入方向；其提出的raw whitespace/fragment边界已纳入最后映射回归修复。未由该代理重复运行共享数据库测试。
