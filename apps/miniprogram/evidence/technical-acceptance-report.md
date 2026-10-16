# 独立技术签署验收原生切片

2026-10-16，基线fdaff1a。仅apps/miniprogram；按已批准计划Task3与API exact契约实施。主控已授独占Git窗口，本报告及本包文件精确提交；提交编号由主控封存记录关联。原Mock、API/admin、法务正文、依赖/锁、旧库及冻结发布副本未修改。

## 本人流程与边界

- 账户设置仅显示已分配给当前客户的独立技术验证摘要，未登录或无记录无办理入口；独立详情完整展示已解析正文、编号/版本、模板/正文/业务文件摘要与实际冻结PDF SHA256。未知状态、错误归属、空/未解析正文、错文案类型、无PDF摘要不允许确认或签署。
- 阅读确认和必要数据处理选择均默认未勾选，必须对应fresh详情的revision、三项确认hash与disclosure/privacy版本。实名/登录同意不替代本文件同意；不再次收集身份证或车辆资料。一般协议过期时明确引导现有账户设置，用户主动阅读/更新后回来重新阅读和勾选，绝不静默补同意或反复实名。
- enabled只管签署执行：关闭时按服务端canConfirm可先阅读确认/准备双审；actual sign必须独立开关、canSign、有效不同人员APPROVED计划和原生精确域名配置共同允许，不隐式开放正式合同。只调用独立technical-acceptances，无订单/账单/支付/信用/库存/交接/权益操作。
- technical-acceptance kind复用原生精确域名、固定return、TTL和客户/token/generation/flowVersion策略。短URL仅内存，storage只存kind/id。onShow、App前台恢复与webview消息均只做纯DB GET；主动点击核验才POST sync。页面返回、单方签署、未归档或异常不标双方完成，也不称整体平台/商业服务验收通过。
- stop按原record/revision稳定key，清本流程URL、不声称供应商已撤销；停止与迟到可信SIGNED+signedFile归档事实分列。关闭开关后的被动读取也关闭已渲染webview。PURGED保留历史签署事实但不声称已删除归档仍可下载，不重开签署。
- 下载先fresh本人详情匹配source/signed ID，再复用Bearer文件接口；下载期间客户/token变化或登出generation变化即不打开文件。公共配置迟到401不清新客户会话，仍返回错误不导航。
- 页面/服务busy与lease防重入，未知响应保留稳定key，已知sync后下一次主动查询用新key；每await防旧会话结果，旧finally不解锁新lease，unload失效旧页面回包。操作期间onShow不启动被动GET，仅当前操作409恢复可force读；已归档sync立即忘记旧入口，fresh签页按当前canSign/可信终态清URL，审批过期不重开缓存。全文/身份/短URL不进入持久前端缓存或证据日志。

## 当前验证

- 新增32行为测试：31项观察红→绿，1项后续补充正向；最新完整client216/216、0skip。受影响native/settings/technical60项通过；check通过，最后HTTP修复后重新build101源文件、18WXML/19WXSS。production注册17主包页面及1原刷脸子包页面，4tab保留。Mock109文件×2副本SHA零差异。
- actual-wcc 15种离线合成状态，390×844，15完整PNG及8张上下视口图，零溢出/JS异常/外部请求。使用批准模板全文仅替换合成参与者/时间/编号/位置；摘要/文件ID为合成，不冒称真实文件生成或签署。含双未勾选、只读未授权、两项主动选择、待双审、可签、部分处理中、可信归档、停止在途、停止迟到归档、开关关闭仍可确认、一般协议需更新、清理与已签历史、设置已分配/空记录。见[layout/report.json](technical-acceptance-layout/report.json)。已目视首屏、两项选择与一般协议升级提示；无身份输入、金额或支付按钮。
- 后台交叉只读review发现A操作迟到409回读可覆盖B详情P2，已报告主控与后台负责人（未修改后台）；其以resource/record/form generation修复后，我独立回读并运行technical11/11，原复现边界已关闭，sourcePdfHash与PURGED历史SIGNED文字也对齐。后台负责人反向复现原生onShow GET覆POST P2，已在本包新增原顺序红回归后最小修复，并获其同VM独立复核。独立reviewer最后重跑32/32，并核对四项源码SHA、canonical planHash与终态/URL/生命周期守门，无剩余明确原生阻断。其报告明确恢复段24请求与此前13请求checkpoint的证据边界，以及合成供应商复制PDF可能产生相同SHA，不能当作真实签名证明。

冻结产物为本包`.artifacts/production`：103总文件（101源文件及项目配置/清单），`FILE-MANIFEST` SHA256为`b31b5bab484a804176af5f2b946b09c793c02be7d3ee3d7dce680e66cfc1919a`，目录SHA256为`c952406e6c18848841f499ae17f77fba3dc37f54b46292a87d039e3680828cdc`。目录算法为排序后的UTF8相对POSIX路径、NUL、文件SHA256小写hex及LF逐项连接后SHA256；元数据位于ignored `.artifacts/technical-final-artifact.json`。最后源码修复后已重新构建，未沿用修改前产物，冻结后不再改写build。

## 本地HTTP与实际DTO差异

早期独立UI夹具仅登录/读摘要，因API安全/PDF修复多次按主控要求结束旧内存会话，没有对旧夹具进行技术写，也没有将等待计为通过。

主控稳定3191服务、独立technical_signing_ui_acceptance库后执行真实HTTP：

- 13请求节点已观察通过：保持原客户登录后由后台发布下一版合成privacy，使canConfirm/consentRequirementsMet=false；客户端未发确认，沿现有acceptConsents明确阅读接受最新terms/privacy并刷新，恢复后本人逐份confirm。本人冻结PDF响应SHA匹配sourcePdfHash，未触发实名或渠道签署。后台随后OPERATIONS申请、另一ADMIN实际批准，同文件hash不变。
- 之后真实预flight发现客户端误按64裸hex校验既有planHash，实际固定来源返回`sha256:64hex`，故本地canSign=false而服务端true，尚未POST sign。新增先红后绿的真实格式回归，主要fixture换canonical前缀，严格拒缺前缀/坏hex/错算法。没有修改API或固定来源文件，也没有重建/重复确认/重审批本份记录。
- `node scripts/qa-technical-acceptance-http.cjs --resume-approved` 在原已确认/双审记录恢复：16检查、恢复段24请求通过；本人sign仅捕获本地签页导航，不打开syntheticURL；被动GET未误标SIGNED，主动sync后仅可信双方结果+真实本地PDF归档才完成。本人source/signed PDF实际二进制成功，另一客户详情及两PDF均拒绝；本人stop后STOPPED与SIGNED事实并存，后续sign被阻，迟到事实仍可读。正文/会话/短URL未写证据。[customer.json](technical-acceptance-http/customer.json)记录安全路径/状态/文件SHA及此前13请求checkpoint，未伪造已丢弃旧进程的逐请求trace。

以上是本地真实应用/认证/数据库/HTTP及内存供应商替身，不是微信SDK或真实法大大签署/用印验收。客户端业务写已停止，后台可只读回看主记录，另以独立记录验证后台stop/到期清理。

本切片未调用生产、旧库或真实供应商，未做真实身份、签署、企业章、付款/退款、原生SDK、二维码、预览或上传。离线和本地DI验证不代表本人/两位真实管理员已经完成生产电子签署验收。
