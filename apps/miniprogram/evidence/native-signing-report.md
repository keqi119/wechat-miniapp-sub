# 小程序内实名与签署恢复验收

2026-10-16。隔离工作树 `C:/Users/keqi_119/.codex/worktrees/miniapp-native-signing/wechat-miniapp-sub`，基线d96ac7a。仅本包修改，根工作区B2成果未覆盖。此前H5报告保留为历史，本报告描述当前原生入口。

## 实现与审查修复

公开配置须为MINIAPP_WEBVIEW，enabled和signProviderConfigured同时有效才允许用户主动创建。实名、主合同、交接、AMENDMENT走正确接口，无H5/剪贴板/旧域fallback。报价显式阅读确认、交接物理事实确认、已签文件查看及原服务端门禁保留。

实名独立同意默认未勾选，绑定当前privacy id/version，明示姓名、证件资料及已绑定手机号提交法大大，拒绝不影响浏览和已有合同查询。表单离开/成功发起/清缓存/退出时清除；自动回查只GET readiness，可能申请证书的refresh是独立主动动作。

仅接受两个已核验HTTPS精确host：textapi17.fadada.com、realnameverify16.fadada.com。拒所有显式端口（含443）、凭据、空白、反斜杠、fragment和相似host；opaque query原字节保留。固定公共返回地址仅用于当前流程reload，不接受任意消息替换。短签URL/task只存内存，TTL10分钟；签署持久缓存仅kind/id，无URL/身份证。普通登录token沿既有会话存储，不额外放入签署缓存或URL。

onShow/message只查询可信服务端。SIGNED须归档，返回、消息或faceResult不能产生成功；冷启动不自动创建。查询异常清除伪成功。请求绑定customer/token/generation/flowVersion，每个await后重新核对；鉴权回包亦丢弃旧会话结果。busy lease按引用释放，旧finally不解锁新请求。终态销毁短签任务并使在途创建失效；页面状态版本在查询开始及完成更新，onUnload使页面和load版本失效。

独立审查复现的跨账号迟到URL、迟到reload覆盖SIGNED均已修复。6项新增promise交错回归先红后绿，覆盖退出/换客户/同客户换token、公开config在途切账号、旧finally、两个reload/query顺序与卸载。审查代理用原始复现顺序复核：旧响应拒绝、navigate0、无pending写入；SIGNED保持且URL空；卸载后无额外setData。其报告由主控保存于根工作区apps/admin/qa/native-signing-review.md。

## 刷脸边界

保留verified_way=1三要素补充路径，不因缺刷脸配置统一禁实名/签署。主控核读[官方API v2文档](https://market-10039692.file.myqcloud.com/document/0/cb48fb0350d5c487f396d919a1f45fc7.pdf)第18页：三要素通过可直接成功，失败才进入刷脸。前端未变更验证强度。

当前faceBridgeConfigured=false。官方路径pagesFace/pages/middle/middle已注册，但实际中间页拒绝执行未经可信当前flow绑定的四参数。已授权旧Projects精确搜索和官方ZIP全文检索未找到可确认的生产刷脸AppID/path；DEMO使用动态参数，不猜值。纯helper覆盖TTL、AppID/path/callback、scene1038/referrerAppId边界，不能据此声称实际刷脸已接通。账户发起前提示需要刷脸时暂不能继续。后续确需刷脸仍须补可信当前flow配置与回跳绑定。

## 最后实际验证

- 全包137/137，无跳过：基线124，移除12项仅H5行为，新增20项native、4项policy、1项子包工具验证。新用例包含已观察红→绿和补充通过用例，不宣称每项均先红。
- build成功：93文件、17WXML/18WXSS；保留16主包页面及4tab，新增1官方中间页子包。
- actual-wcc离线合成版面14/14、14PNG、390×844，无溢出/JS异常/外部请求；覆盖实名/三kind容器、关闭、冷pending、归档、实名就绪、三kind查询错误、中间页缺配置、账户独立同意。逐页见[native-signing-layout/report.json](native-signing-layout/report.json)。已目视账户完整授权文案、归档页及中间页；供应商容器为离线占位，未加载供应商网页。
- 两工作区reference/miniprogram-mock按既有manifest各109文件SHA256校验，0差异。git diff --check本包无错误。

实际命令：`pnpm --filter @independent-platform/miniprogram test`、`pnpm --filter @independent-platform/miniprogram build`、`node apps/miniprogram/scripts/verify-native-signing-layout.cjs`。

产物：`C:/Users/keqi_119/.codex/worktrees/miniapp-native-signing/wechat-miniapp-sub/apps/miniprogram/.artifacts/production`；源码同工作树apps/miniprogram/src。主控从此隔离产物冻结/预览，不使用根B2 live产物。

本轮未访问业务DB/生产API/真实供应商，未运行DevTools SDK/CLI、真实实名/短信/签章/付款、生成二维码或上传。实际微信web-view/三要素/条件刷脸及真实签署由主控按明确范围继续验收。
