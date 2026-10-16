# 法大大微信小程序集成准备度与最小接入设计

日期：2026-10-16。当前决定：微信业务域名实际校验失败后，用户已选择原服务号 H5 签约、回小程序同步。实施依据为 `docs/superpowers/specs/2026-10-16-service-account-h5-signing.md`；本文第1—6节保留为此前内嵌方案的调查记录，不再作为当前施工或供应商确认清单。官方流程与实际DEMO已只读核对。用户最新要求参考既有服务号H5实现，直接验证微信配置，不再以法大大确认作为前置步骤；以下官方材料保留为技术参考，不能把待确认清单当成已发出的供应商请求。本文初始调查未执行供应商代码或真实实名/签署；后续本方校验文件部署及微信配置进展见第7节。

## 1. 证据与下载检查

官方依据为本机保存的5.1.2《接入方微信小程序集成法大大页面应用开发流程》与5.1.3《小程序内嵌方案》，原文件位于 `D:\Projects\document\fadada\doc`，文本摘录位于 `.runtime/fadada-docs`。已对5.1.2流程图和参数表进行视觉核对。

5.1.2给出的公开下载地址：[示例视频及demo代码包.zip](https://static.fadada.com/%E7%A4%BA%E4%BE%8B%E8%A7%86%E9%A2%91%E5%8F%8Ademo%E4%BB%A3%E7%A0%81%E5%8C%85.zip)。2026-10-16 08:29:15 UTC取得HTTP200、application/zip、19,866,238字节；未允许HTTP重定向。压缩包SHA256：

`08c333c5c8171eb7e22105d2341d2d5515661e99d2854f6ec46f751221814749`

原包保留于 `.runtime/fadada-docs/fadada-wechat-demo-20261016.zip`。下载限制50MiB；检查展开大小、单文件大小、压缩比、路径越界/绝对路径/Windows盘符/特殊路径、符号链接、加密成员和嵌套深度。只提取有界文本文件，不解压视频及二进制，不运行npm/脚本/小程序示例。首次检查将macOS `__MACOSX/._*.zip`资源元数据误当内层ZIP而停止，原记录保留；识别并跳过元数据后同一已下载归档检查通过，没有重复下载。

证据文件：

- `.runtime/fadada-docs/demo-download-evidence.json`：来源、HTTP元数据、大小、SHA256及未执行说明。
- `.runtime/fadada-docs/demo-zip-inspection-first.json`：首次元数据识别停止记录。
- `.runtime/fadada-docs/demo-zip-inspection.json`：最终路径与大小检查及成员清单。
- `.runtime/fadada-docs/demo-code-manifest.json`：13个文本文件的原归档成员路径、字节数和SHA256。
- `.runtime/fadada-docs/demo-code`：从内层DEMO复制的原字节文本；实际查看的是这些文件，没有修改供应商文件。

下载成功只证明取得官方公开示例，不证明示例中的对接方式已为本账号开通，亦不证明真实刷脸或签署通过。

## 2. 从真实DEMO确认的协议

DEMO `app.json`注册 `pagesFace` 分包下的三个页面：`pages/index/index`、`pages/webview/webview`、`pages/middle/middle`。

| 文件与位置 | 实际行为 |
| --- | --- |
| `pagesFace/pages/index/index.js:31` | 测试入口允许人工输入或扫码取得任意URL，再用 `encodeURIComponent(url)` 传给webview页的 `url` 参数。这个任意URL测试入口不能原样开放到生产。 |
| `pagesFace/pages/webview/webview.js:8` | `onLoad`对 `options.url`调用一次 `decodeURIComponent`，设置web-view地址。 |
| `pagesFace/pages/webview/webview.js:16` | 提供 `reloadPage(url)`，直接将传入地址重新设置为web-view地址；示例还输出完整URL日志。 |
| `pagesFace/pages/middle/middle.js:30` | 从原生路由query读取下表四个字段，对每个字段各调用一次 `decodeURIComponent`。默认均为空。 |
| `pagesFace/pages/middle/middle.js:16` | 用户点击“前往认证”后调用 `wx.navigateToMiniProgram`；`appId=miniProgramAppId`，`path=miniProgramPath + '?bizToken=' + bizToken`。没有设置 `envVersion`，没有在本代码中写死刷脸小程序AppID。 |
| `pagesFace/pages/middle/middle.js:21` | 跳转API的success只把 `goFaceDone`设为true。它表示跳转已发起，不能视为刷脸成功。 |
| `pagesFace/pages/middle/middle.js:41` | 返回中间页后，若 `goFaceDone`为true则先清除此标志，再调用 `wx.getEnterOptionsSync()`。示例注释注明基础库2.9.4起支持，但实际没有能力检测或兼容分支。 |
| `pagesFace/pages/middle/middle.js:57` | 仅判断 `scene===1038`、`referrerInfo.extraData`和 `faceResult`为真。随后取页面栈前一页，调用其 `reloadPage(miniProgramCallBackUrl)`，再 `navigateBack({delta:1})`。代码没有解释faceResult的结构或成功/取消含义。 |

四个中间页参数的名称和大小写必须准确：

| 参数 | 已确认用途 | 尚未确认的生产约束 |
| --- | --- | --- |
| `bizToken` | 刷脸业务token，解码后附加到目标小程序path | 长度/字符集/有效期/是否可重放、与本实名或签署任务的绑定方式 |
| `miniProgramAppId` | 目标刷脸小程序AppID，从路由参数注入 | 本账号生产允许的精确AppID及平台审批要求 |
| `miniProgramPath` | 目标刷脸页路径，从路由参数注入 | 精确路径、是否允许已有query，以及bizToken的正确编码约束 |
| `miniProgramCallBackUrl` | 刷脸返回后重新加载的认证/签署H5地址 | 精确生产origin/路径、URL映射规则、有效期与任务归属 |

根据5.1.2流程图，供应商认证/签署H5在需要刷脸时进入接入方原生中间页。DEMO只有读取路由参数的接收端，没有包含生成该跳转的供应商H5源码，因此不能从ZIP确定H5如何取得接入方微信AppID、完整跳转参数或生产callback地址。

### 是否硬编码测试配置

核对13个提取文本文件，DEMO JavaScript没有写死 `realnameverify-test`/`test2`域名、任何生产业务域名或 `wx...`刷脸AppID；四个中间页字段从query注入。`webview.wxml`仅绑定 `url`，没有域名校验。

这与PDF截图中的示例替换代码有所区别：5.1.2截图演示过认证回跳域名替换，而本次下载的 `middle.js:62`直接传入 `miniProgramCallBackUrl`，没有执行任何映射。不能把PDF测试域名当作本账号生产值，也不能因为DEMO未映射就省略5.1.3要求的专属业务域名适配。

DEMO没有核对 `referrerInfo.appId`、当前用户/流程nonce、任务有效期或callback origin；未防护缺失referrerInfo、解码异常、错误页面栈和跳转失败/取消；还会记录完整URL及入口参数。它提供往返调用顺序，生产安全控制需独立补充。

## 3. 官方参数与域名要求

5.1.2明确：

- 个人/企业实名认证地址接口使用 `is_mini_program=3`。
- 手动签 `extsign.api`及所列半自动接口使用 `open_environment=4`。
- 快捷签所列接口使用 `is_mini_program=3`。
- 需要原生中间页承接刷脸小程序往返；返回后重新加载认证/签署H5。

5.1.3要求把微信小程序校验文件、接入方微信APPID及平台名称提供给法大大，由供应商配置后回复该小程序可访问的专属域名。接口返回通用URL时，需要映射到该专属域名；实名return_url之前的供应商内部跳转还受请求API域名影响，所以服务端API origin也须按供应商确认的配置使用。域名未配置端口时，URL不能显式携带端口，包含默认 `:443` 也不可以。

此前配置的request/uploadFile/downloadFile合法域名不能自动替代web-view业务域名。用户已确认纯电主义尚未配置法大大业务域名；本文不把这一阻断标为完成。生产与最终验收保持微信域名校验开启，不采用关闭校验绕过。

后续用户已明确保留小程序内签约，沿用现有旧API/账号，仅补微信域名校验，不新开API账号或套餐。主控只读比对现有API应用与企业账号标识一致，未向本文件提供或输出密钥值；所查Projects仍只有textapi与H5return，并无已经完成的微信业务域名配置。此前准备过原样校验文件包，但没有发送；用户后续明确不再由法大大确认，转交请求已撤下，改为直接在微信平台验证既有域名。若实际接入出现域名映射需求，只根据可核验证据处理，不新开户或擅自替换协议。

需要区分三类AppID：接入方“纯电主义”微信小程序AppID、后端法大大API应用标识、目标刷脸小程序AppID。DEMO的 `miniProgramAppId`属于第三类，不能用前两类替代。用户指定的企业印章编号由主控核验后端印章与授权链，不决定任何微信AppID或业务域名。

## 4. 当前实现差距与已有可保留部分

当前原生 `apps/miniprogram/src/pages/sign`仅有web-view、返回后状态查询和通用navigateToMiniProgram分支；未注册pagesFace分包，没有官方中间页、reloadPage回跳协议或四参数解码/校验。`services/api.js`当前持久化完整签署URL；URL校验允许显式`:443`；通用小程序跳转未约束目标AppID/path。当前 `signingHosts=[]`拒绝未经核验的入口，应在准备度未满足期间保持关闭。

复用自提交 `453da778dcfefd3727813179382490903644ef26` 的 `fadada-api.client.ts`原本未传微信专用参数：getPersonVerifyUrl缺is_mini_program，实际使用的带坐标extsign分支缺open_environment。未带坐标的extsign_validation分支不在这两份PDF明确列出的环境参数范围内，不能自行认定也可传4或切换到其他签法。

后端当前只允许fadada.com域名作为baseUrl；如供应商回复不同专属origin，须经过明确核验后更新精确白名单，不能简单移除校验。现有 `/public/esign-return`是提示用户手动返回的页面，尚未组成官方刷脸往返链。

现有服务端实名attempt/CAS、当前身份绑定、签署任务归属、不可变PDF/hash、双人用印审批、双方真实签署查询和签后归档继续保留。原生web-view消息目前只触发服务端查询，不直接认定成功，这一原则继续保持。配置完整之前，准备度应在真实供应商创建任务/上传前检查，避免仅在返回URL时由前端拒绝一个已经产生外部副作用的任务。

Projects参考核对范围为auto-subscription-platform主源码及相关微信原生分支、所给官方归档。主H5合同页通过window.location.assign打开实名/签署URL，交接H5同样走浏览器重定向；相关原生分支未发现pagesFace桥接。所查旧实现可参考业务状态回读，不能视为该微信往返方案已验收。

## 5. 最小接入设计

1. **先建立后端准备度与只读entry契约。** 按身份/合同/交接区分当前用户和任务；定义不透明flowId、有效期与用途，服务端核对供应商账号、已确认origin和目标小程序身份。未满足配置时在供应商副作用前拒绝。正式DTO由API负责人对齐，不在本次文档任务中添加可用占位入口。
2. **参数在摘要构造前加入。** 微信模式的实名请求加入is_mini_program=3，现有带坐标extsign加入open_environment=4；以已支持版本的官方公式核对摘要黄金样例，保留pinned结构，不无声替换SDK。extsign_validation保持未确认能力关闭。
3. **精确URL受控映射。** 将供应商确认的通用源origin映射到本账号专属目标origin，分API、实名H5、签署H5、回跳/查看用途；严格HTTPS、无userinfo、无显式端口，拒绝未列入来源、路径或外部return URL。保留签名相关路径/query字节，避免对整串URL做replace或重复解码。所有可见及供应商内部跳转域名都需确认。
4. **沿官方中间页协议接入。** 保留供应商要求的准确页面路径和四参数名称；初始入口由现有签署/实名流程发起，生产不开放DEMO的任意URL输入/扫码页。是否必须保留三页完整路径需供应商确认。每个参数只按协议解码一次，设长度/格式边界；目标AppID/path及callback URL必须与当前服务端授权flow匹配，不能信任路由输入。
5. **返回只恢复流程并查询。** 检查基础库能力、scene、referrerInfo及预期目标AppID、当前flow关联/期限；仅将faceResult视作返回事件。通过受控reloadPage恢复当前H5，再查询现有服务端权威状态。取消/失败/超时/旧流程返回不得覆盖新流程，也不能据消息认定实名、证书或SIGNED。
6. **缩小敏感数据驻留。** 不记录完整URL、bizToken、referrerInfo及签名参数；只持久化不透明任务标识，必要entry由鉴权后端恢复。前后台不暴露appSecret或其他账号密钥。回跳参数只短期用于当前实例，清理已结束流程。

可在供应商字段未确定时独立完成配置模型（空值关闭）、纯URL映射/拒绝测试、四参数解析与能力兼容测试、当前flow关联及旧返回拒绝、生命周期恢复和敏感日志/持久化收敛。不能在这些纯测试中声称生产刷脸成功。真实目标值与官方路径确认后才连通页面、API参数和域名。

## 6. 待供应商确认与后续验收

| 待确认项 | 确认后用途 |
| --- | --- |
| 本账号是否开通5.1.2方案，所用旧协议版本是否支持实名3/手动签4 | 决定请求参数及摘要验证边界 |
| 接入方微信AppID绑定、校验文件部署结果，专属API/page origins和所有跳转链 | 配置微信业务域名及服务端精确映射，保持urlCheck开启 |
| 生产刷脸小程序AppID、精确page path、环境、可跳转权限 | 限制DEMO动态参数；不复制未知AppID |
| H5进入本方middle的准确路径/参数生成规则、bizToken约束与失效行为 | 正确编码、绑定当前flow，防止错误/旧token复用 |
| scene/referrerInfo.extraData.faceResult的结构、成功/取消/失败、基础库与平台兼容要求 | 安全恢复H5并触发权威查询，不把导航成功当认证成功 |
| miniProgramCallBackUrl的各流程允许origin/path，域名替换是否影响签名参数 | 避免通用地址、测试地址或任意重定向进入生产 |
| extsign_validation在本账号/版本的微信支持情况 | 决定保持关闭还是另行实现，不能根据extsign文档推断 |

取得上述确认后先运行有界纯测试：单次/双重编码、缺参数、错误AppID/path/origin、显式443、错误referrer/scene、过期及不同任务、跳转失败与取消、基础库方法缺失、返回消息伪成功、敏感URL不落storage/log。随后由主控在明确授权范围内做iOS/Android物理微信往返验证，核对合法业务域名、刷脸取消/成功后的服务端实名/证书状态；真实签署仍须另行满足正式法律文案、PDF、企业印章授权及双人审批。当前没有开展这些真实验证。

## 7. 参考线程核对及微信直接验证

用户指定参考线程 `01a143ea-6d96-7081-ac73-a49fc4ee511c`。已读取其检查结果并核对本地原文件：旧项目 `docs/superpowers/specs/2026-08-01-staging-wechat-payment-and-mobile-billing-design.md` 记载公众号网页授权域名与 `MP_verify_*.txt` 校验；旧H5合同页通过 `window.location.assign(result.signUrl)` 打开法大大页面。旧 `docs/stage-10d-fadada-api-audit.md` 记载现有生产渠道为 `https://textapi.fadada.com/api2/`，允许其既有回调及回跳域名。这些是复用旧接口链路的依据，未提供小程序web-view业务域名已经登记的证据。

本方 `mini-api.subauto.keybox.cloud/G1wS8MuuaR.txt` 已于16:59部署并从公网校对原字节，API和后台健康，见 `docs/evidence/wechat-business-domain-proof.json`。其用途是新系统网页返回地址的域名验证，没有改变法大大API账号。

本次直接GET `https://textapi.fadada.com/G1wS8MuuaR.txt` 返回404，未找到相同校验文件。随后在“纯电主义”微信开发设置实见业务域名尚未配置；打开配置填写 `textapi.fadada.com` 并保存，微信进入管理员扫码步骤。管理员扫码后，用户明确反馈微信结果为“校验失败，提示校验文件验证失败，请确认已在域名根目录正确放置校验文件”。再次读取网页实见业务域名仍为空；用户于后续选择“改用原服务号 H5 签约入口，签后回小程序同步状态”，因此已关闭业务域名配置弹窗，不再重复扫码。出现二维码不等同于添加成功。没有重置密钥、关闭域名校验、发起实名或创建签署任务；域名校验失败时记录实际平台反馈后再处理。

## 8. 此前准备的 H5 路径（已被第 9 节恢复原生方案替代）

采用原 `app.subauto.keybox.cloud` 主机下独立 `/miniapp-sign/`，仅反代新 API 专属路径。短信登录、客户及合同均使用新系统独立数据库；旧门户会话与 OAuth 不参与认证，旧项目数据不修改。原服务号菜单未修改。

只读核验旧项目 `.tmp/fadada/test-signer-realname/latest.json` 的真实实名地址首跳为 `realnameverify.fadada.com`，`.tmp/fadada/upload-signurl-smoke/latest.json` 与 `signpage-semantic/latest.json` 的签署首跳为 `textapi.fadada.com`。只取主机名作为精确允许列表的证据，未打开原带凭据 URL、未把其 query 或个人信息写入本文件、未发起供应商调用。

实名和签署仅由用户在 H5 主动发起，返回地址固定到新 H5，可信回调和查询仍归新 API。正式实名、企业印章审批、真实签署及签后归档尚待实际验收，不以页面发布代替。

## 9. 2026-10-16 18:40 恢复小程序内签约

用户提供法大大 API 交付支持邮件截图，并明确确认业务域名校验已通过、要求按原小程序内签约方案推进。该指令替代此前的 H5 入口选择，无需再申请新 API 账号。

正式 API 地址改为 `https://textapi17.fadada.com/api2/`，实名认证业务 origin 为 `https://realnameverify16.fadada.com`。两个域名根目录的 `G1wS8MuuaR.txt` 均实际 GET 返回 200，与用户原始 32 字节校验文件完全一致。用既有账号在新 API 地址执行只读 `query_signature.api` 返回 200 / code 1，找到用户指定印章；未发起实名、签署、授权或修改生产配置。证据见 `docs/evidence/fadada-native-domain-verification.json`。

恢复工程从冻结版本的隔离工作区实施：小程序内 web-view 承载实名、主合同、交接单及补充协议签署；通过原 API 的客户归属、文档哈希、双人用印批准、状态机和可信渠道查询/回调更新结果。精确映射法大大通用返回域名到上述已核验域名，不接受任意 URL 或未知刷脸小程序身份。用户必须主动发起实名和签署；网页返回本身不证明成功。已开发的换车功能保留在主工作区，待单独验证后集成。

此前 H5 发布尝试均已回滚，旧 API 继续健康运行，新增数据库迁移为兼容性迁移；H5 备用代码保留但不作为当前主流程发布。仍需验证原生中间页、刷脸小程序精确 AppID/path、真机往返与签后归档，不能把域名校验或只读接口成功视为签约验收完成。
