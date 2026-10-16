# 原生签约恢复独立代码审阅

审阅日期：2026-10-16。基准：`d96ac7a`。来源：`C:/Users/keqi_119/.codex/worktrees/miniapp-native-signing/wechat-miniapp-sub` 的当前提交及未提交/新增文件。只读该 worktree；未调用生产、供应商、数据库或运行 API 数据库测试。本文由后台实现人员独立审阅，不代表真机或真实法大大签署验收。

## 发现与处理

### P1：在途旧会话响应可把旧客户签署短链接绑定到新会话

首次审阅位置：`apps/miniprogram/src/services/native-signing.js:24-35,38-50,66`。`startSigning` 在 await 之前仅检查当前账号，`enter` 在响应到达后重新读取当前账号并将其作为 task.customerId；`clearSigningState` 清 Map 不会让在途 Promise 失效。底层 `api.js:69-79` 的成功响应也不校验发起 token。

合成纯内存复现：A 发起主合同签署，延迟 POST 响应；调用 clearSigningState 并将当前会话改为 B；返回 A 的合成 PENDING/短链接。结果 `navigatedAfterSessionChange=true`、`oldCustomerTaskVisibleInNewSession=true`。虽后续业务状态查询有服务端归属检查，已经取得的外部短链接仍可能展示 A 的签约内容，因此不能仅依赖状态接口的 403/404。

修复要求：捕获发起 customer/token/session generation，在每个异步边界（包括公开配置、当前隐私、register/verify、最终导航）验证未变；清除状态应递增 generation；旧 finally 不能解除新 generation 的 busy。已通知主控及原生实现人员，待补丁回读。

补丁复核：已关闭。`native-signing.js:13-15,27-46,49-56,66-72` 捕获并检查 customer/token/generation/flowVersion，各异步边界均守门；clear 递增 generation；busy 通过 lease 引用释放。`api.js:72` 丢弃旧 token/customer 的回包。独立重新执行上述原始 Promise 顺序，旧响应报 SIGN_SESSION_CHANGED，导航为0、task URL为空、没有 pending storage。实现人员另补同客户换 token、退出、配置加载期间账号切换及旧 finally 的回归。

### P2：迟到配置加载会覆盖已核实签署结果并重新打开旧链接

首次审阅位置：`apps/miniprogram/src/pages/sign/index.js:8,13`。onLoad 的 reload 与 onShow 的 refreshStatus 独立写入 status/url。纯页面合成重现：延迟 getSigningConfig，先让 sign-status 返回 SIGNED/归档，再完成旧 reload；最终由 SIGNED 回到 PENDING 并重新展示旧 web-view URL。不是伪造数据库状态，但掩盖了最新可信结果并再次打开已完成页面。应使用统一页面 generation/revision，状态查询完成使更早 reload 失效；卸载/账号变化也应使旧响应失效。已通知原生实现人员。

补丁复核：已关闭本复现。`sign/index.js:5-14` 在配置 await 后重新检查当前 task，并以 statusRevision 避免覆盖更新状态；终态设置 terminal、删除 task/递增 flowVersion。独立重新执行“先 SIGNED、后配置”顺序，最终仍 SIGNED、URL为空。终态失效也阻止同资源更早在途请求重新写入短链接。

最终追加回读：页面 onUnload 递增 pageGeneration/loadRevision；状态请求在成功/错误处核对 generation，查询完成再次递增 statusRevision。独立合成执行反向“先查询、再 reload、SIGNED、最后配置”及“卸载后状态/配置到达”顺序，均保留可信结果或不再写已卸载页面。实现人员反馈最新 native 20/20 通过。

### P2：实名独立同意概述漏掉实际提交的已绑定手机号与拒绝影响范围

首次审阅位置：`apps/miniprogram/src/pages/settings/index.wxml:36`。概述仅写姓名及证件资料，但 `apps/api/src/esign/customer-esign-onboarding.service.ts:43` 实际还提交 customer.mobile。与之前已批准的 H5 隐私落实要求一致，应沿现有隐私正文明确向法大大提交姓名、证件、已绑定手机号，以及拒绝只影响实名签约，不影响浏览和既有合同查询。API 独立 consent 的当前 privacy 版本和审计记录本身正确。已通知原生实现人员。

补丁复核：已关闭。该行现明确“向法大大提交本人姓名、证件资料及本账户已绑定手机号进行实名核验”，并说明一般登录同意不能替代本次选择、拒绝不影响浏览及已有合同查询；默认不勾选与当前文档版本仍保持。

## 未发现新阻断的检查项

- `apps/api/src/auth/access.ts:49-55`：客户 Bearer 会话有效期、原生副作用 POST 独立开关和当前 terms/privacy 共同守门；大小写/尾斜线处理纳入路由匹配。关闭原生不会自动走 H5。
- `apps/api/src/esign/native-signing.ts:5-46`：只接受已批准两个精确 host、固定新 API return；拒绝 userinfo、显式端口、HTTP、域名后缀混淆、fragment、空白、反斜线；实名仅精确 origin 适配并保留签名 path/query 原字节。供应商 API base 另由 adapter 校验。
- `apps/api/src/esign/native-fadada-adapter.ts:12-31`：原生 async context 限定新增 is_mini_program/open_environment；固定回跳；保留原 SDK 请求构造和签署坐标；H5 请求不自动套原生参数。
- `apps/api/src/esign/realname-consent.ts:6-8`：strict 本次明确同意；当前 privacy id/version 与当前一般协议同意在审计前校验；审计仅文档 id/version/hash/source，不含姓名、证件或手机号正文。
- `apps/api/src/orders/signatures.ts:11-32`、`operations/workflows.ts` 客户 handover sign/status、`order-changes/signing.ts:12-18`：三类记录继续按客户归属、当前版本、文档 hash、租约和已批准企业签章方案守门；AMENDMENT 使用独立 kind，签署不直接认定变更生效。
- `apps/api/src/esign/fadada/fadada-esign.provider.ts` callback/query 继续验证供应商签名与交易/文档归属，并可信查询客户和企业签署及归档 PDF；`esign.controller.ts:63` 公共返回页不读取 query 结果，也不修改业务状态。
- 原生 web-view 的 message 仅触发服务端查询，SIGNED 必须有服务端归档；短链接只在内存、持久恢复仅 kind/id，身份证输入不写 storage/log。冷启动不自动登记/实名/新建签署。
- face bridge 明确 `false`、空允许列表，middle 页拒绝任意注入参数；没有根据四个 query 参数直接跳未经核验的 AppID/path。当前仅三要素分支可待主控另行真实验收，转刷脸仍无法继续，不能宣称完整刷脸闭环可用。

## 部署文件补审

- `deploy/prepare-native-config.py:9-40` 仅修改本项目指定键，校验 usage-v1 基线、重复键和先前签章开关；原生/H5/总开关/注册/实名/签署均固定 false。原配置其余行不改，临时文件 0600 后原子替换，不输出密钥。
- `deploy/test_prepare_native_config.py` 覆盖原值保留、默认关闭、重复键、未知基线、原已启用开关和非法 release；本次仅审阅测试源码，未执行生产路径。
- `deploy/activate-native-release.sh:9-53` 校验 release/三个 archive SHA/当前静态与 API 基线；备份 env/deploy/本项目 vhost；失败恢复 env/deploy/vhost/current/API，迁移不反向回滚且明确说明；旧 app vhost 不修改，仅核对 SHA。未发现需新增阻断的变更。
- `scripts/publish-approved-delivery-delay-legal.mjs:10` 仅扩展 native release 名匹配，原批准 manifest、批准源与正文 SHA、版本内容一致性、部署 health version 和公开回读仍在；不把模板发布记为客户确认或实际签署。

### 后续追加 P2：CI 上传前未校验完整编译文件集合

`scripts/miniapp-ci.mjs:14-20` 当前只校验 manifest 已列文件，未拒绝 `src` 内未列新增文件；未锁定 `project.config.json` 的 `miniprogramRoot='src/'`/compileType，其余编译范围可异于哈希核验范围。可能使上传包含未审阅源码，因此不能把已列文件逐项匹配等同于完整冻结包一致。建议上传前完整枚举并精确匹配 manifest 路径集合、拒绝重复和越界链接、固定 src 根及编译类型；可另以可信冻结记录核对 manifest SHA。已通知主控，未调用 CLI、未读取真实密钥。

另外 `miniapp-ci.mjs:13` 即使显式传冻结路径也无条件 realpath(defaultProject)，缺少本地默认产物时会 ENOENT，建议只在选择默认目录时求其 realpath。

最终补丁复核：已关闭。`scripts/verify-miniapp-package.mjs:6-33` 对冻结 release 强制要求外部 manifest/config SHA，先匹配两文件字节哈希，再固定 AppID/compileType/miniprogramRoot/urlCheck 和无额外 pack include/ignore；项目顶层仅三个批准入口，拒绝项目直接符号链接和源码遍历中全部符号链接；清单 path/hash 受限、重复拒绝，实际 src 文件集合必须精确相等，随后逐项匹配内容 SHA。冻结路径仅对 `.runtime/releases` 真实路径边界核验，不再解析不存在的默认产物目录。`miniapp-ci.mjs:11-16` 在创建 CI Project、调用上传/预览前使用 helper 并传第5/6参数的外部 SHA；成功证据记录两个实际 SHA。

审阅人独立运行 `node --test scripts/tests/miniapp-package.test.mjs`：5/5 临时目录测试通过，覆盖干净环境冻结目录、额外源码、字节变化、外部哈希缺失/配置变化、重复 path/编译根变化。未调用 miniapp-ci、未读取上传密钥、未上传或预览真实项目。符号链接拒绝经源码回读确认。没有剩余阻断发现。

## 验证边界

已执行纯内存合成竞态重现及补丁后独立重现，无真实 URL/资料。原始 P1/P2 两个交错场景均已由失败转为阻断/保持可信结果，隐私概述也已回读核对；当前原生业务流程没有尚未关闭的 P1/P2 发现。实现人员反馈最新 native-signing 20/20 回归通过；审阅人未跑其 API/数据库套件。未修改 worktree，未启动或占用共享数据库、未执行发布脚本、未登录生产、未发短信/实名/签署。其余结论为代码审阅，不能替代微信开发者工具预览和本人真机供应商验收。

CI 脚本为随后新增审阅范围，其 P2 冻结文件集合缺口已完成补丁回读及5项纯临时目录测试复核；原生客户端与 CI 审阅发现目前均已关闭。

## 后续 B2 业务发布脚本补审

`deploy/prepare-business-config.py` 仅更新本项目 BUILD_VERSION/API_IMAGE，保留其它原始配置行；核验 native-v1 基线及当前实名开放/企业签署关闭。`activate-vehicle-change-release.sh` 校验 release/三份包 SHA/current/API image/空间，外层失败恢复 env/deploy/本项目vhost/current/API；内层加密备份先于增量迁移，不反向回滚数据库；旧 app vhost 只核对 SHA。`publish-approved-vehicle-change-legal.mjs` 仍要求批准 manifest、来源与正文 SHA、部署版本、既有版本内容一致及公开回读，记录不暗示客户同意或签署。未执行生产脚本或读取私有环境。

发现配置漂移解析 P2：裸 `KEY=` 解析漏掉 dotenv 的 `export KEY=` 重复覆盖，主控已补测试并修正；审阅人独立运行 Python 合成测试5/5通过。随后合成进一步确认 `FADADA_SIGNING_ENABLED: true`（冒号加空格）同样被本项目 dotenv 接受，而准备器尚未拒绝；已立即报告主控，待统一支持或拒绝该关键键语法后再冻结部署。以上仅用合成内存字符串，不涉及真实开关或密钥。法律发布脚本 `node --check` 通过。

最终补丁回读：解析统一识别 export/键/等号或冒号空格；关键键的冒号形式明确拒绝，任意已识别形式的重复键阻断。审阅人再次独立运行合成 Python 测试6/6通过；正常基线只改 BUILD_VERSION/API_IMAGE，原 provider 开关与其它配置内容保留。以上配置漂移 P2 已关闭，当前业务发布脚本未发现剩余阻断；仍未执行任何生产激活或模板发布。
