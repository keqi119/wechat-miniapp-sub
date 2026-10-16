# 小程序 Task 1 验证事实

日期：2026-10-16。来源提交 `0c78f44bef60211b4738e83f327335af40910340`，复制前 git HEAD 与提交一致、工作树干净。逐文件 manifest 为 `mock-source-manifest.json`；选择 Git 跟踪的完整可迁移工程，明确排除 node_modules、dist、.artifacts、project.private.config.json、本机 config.local.js、日志/诊断及其他未跟踪生成文件。源与 reference 每个被选文件 SHA-256/字节数均核对。

测试先后证据：

- 复制后首次基线：19行为测试通过，2编译工具测试文件因尚未安装 miniprogram-compiler 失败；主控统一安装后再次运行源全部测试，28/28通过。
- 真实 adapter 首轮19/19预期失败（原实现缺少客户方法、错误使用旧目录包装）；实现后19/19通过。
- 真实页面首轮6/6预期失败（API申请禁用、本地附件、缺商业hash、示例交接、演示设置）；实现后6/6通过。
- 私密文件/生产包门禁、新版协议重新同意、启动恢复支付各自观察缺实现/错误行为后修复。
- 最终 `node --test apps/miniprogram/tests/*.test.cjs`：45/45通过，0失败。新增拒绝原因、交接回读/新版本、NEEDS_INFO补件、当前协议持久同意、已登录图片、里程记录入口、14商业条款与月底账期回归先观察失败再修复。
- `node apps/miniprogram/scripts/build.cjs`：85个源码文件，16 WXML/17 WXSS真正通过bundled wcc/wcsc；原15页+签署承载页，4 Tab。输出 `apps/miniprogram/.artifacts/production`，不包括工具、测试、演示资料或本地配置。

对照证据：`apps/miniprogram/evidence/page-comparison/report.json` 和30张reference/real PNG，覆盖原15页、390×844浏览器宽高、无运行时错误、无横向溢出，已在本次完整商业条款显示后重新生成。15份原页面WXSS逐字节保持一致，12 PNG保持一致，Tab配置保持一致。使用原合成展示模型及明确标注的逐单QA文本驱动真实wcc模板的离线截图；这不代表真实API数据、微信模拟器或设备验证。已视觉检查首页、账户设置及完整最终方案样本。业务文字、账户设置、正式协议承载、交接证据/签署入口按真实语义调整，原始样式保留。

接口协调：API实现人员确认车辆详情及分页列表、context customer/profile、finalPlan commercialHash、dashboard subscription/orderId/handover、私密文件鉴权二进制流、handover sign-status和evidence字段与客户端一致。

仍待集成/验收：真实客户API完整流、法大大账号签署域名核验后填入signingHosts（当前为空，拒绝未经核验入口）、微信隐私授权配置、真机登录/上传/支付/签署。主控已实证保存request/uploadFile/downloadFile三类新API合法域名；本任务原生公开GET已复验通过，未冒称鉴权上传/下载已做。正式法律文本现已由用户审定并由主控发布；每单14项商业条款仍必须由运营填写、客户确认，未填旧方案不可签署。本任务未调用微信/短信/支付/法大大线上凭据；未进行真实交易或签章，未推送、部署或发布。

接口协调补充：独立服务器文件预算统一10MB，客户端大小门禁与提示已同步。短信/微信登录必须提交当前terms/privacy文档ID与版本并持久同意；补件通过amend接口替换审核快照；里程使用mileages记录；交接修订新id清空旧阅读/响应。方案确认前展示14项商业条款、超里程单价、起止日期、首付款/押金支付日、每期金额/到期日/服务期间；金额和月底夹取规则与服务端一致，commercialHash绑定全部条款。公开客服电话为用户确认的+86 18616570212。

追加真实开发工具验收：主控开启serviceport并以官方CLI auto导入production源码包后，读取miniprogram-automator 0.13.0本地README/types，连接ws://127.0.0.1:9420。当前WeChat SDK3.17.4、iPhone12/13mini模拟器、window375×639。18个只读路由覆盖16原生页和3种legal文案入口，18/18成功导航及读取.page根节点，0JS exception；本轮实际保存13张PNG，另5次官方App.captureScreenshot超时已单独记录，不能冒称18张均成功。唯一console警告来自SDK读取getSystemInfoSync的弃用提示。未登录用车/账户/资料/记录/工单/里程/交接均显示登录门禁，缺id/套餐显示具体错误，sign无入口不发起签署。真实wx.request GET独立/api/health精确返回“request:fail url not in domain list”，保持urlCheck=true，公开页因此不能读取已部署的正式文案/目录；微信合法域名配置是实际阻断。证据apps/miniprogram/evidence/devtools/production-public/report.json、public-network.json及13PNG，另before-deployment/home.png为较早独立样本。此次仅导航/页面读取/截图和public health GET，未mock响应、改storage/会话/源码、发送短信、登录、支付、实名或签署；仍不是物理真机验证。

域名配置后复验（2026-10-16 05:57 UTC）：主控确认三类域名保存生效后，仅关闭/重开本项目production目录，CLI auto --auto-port 9420 --trust-project启动成功；启动时等待AppID权限的失败现场保留after-domain-config，初次page metadata尚未就绪现场保留after-domain-config-ready。随后SDK原生reLaunch刷新当前页，使用新证据目录after-domain-config-rendered，不覆盖旧阻断记录。读取项目与私有覆盖配置，effectiveUrlCheck=true。原生wx.request GET health、vehicles、terms、privacy、application、subscription、handover共7/7 HTTP200；库存items=0、total=0符合预期，五文档均PUBLISHED v1，文档id/正文长度/SHA256逐项记录。实际首页、空车辆列表、terms/privacy/application三个公开协议页面共5/5无loading/error、.page根节点存在，0JS exception，5张PNG全部保存，已视觉检查首页/用户协议样本。此次未mock、未改storage/源码、未登录或写业务、未pay/sign。鉴权上传/下载和物理真机流程仍未测试。

账户协议链接调整（用户明确指令，2026-10-16 06:05 UTC）：仅修改settings/index.wxml，当前版本协议卡片显示两条带title/version的链接，去掉整段content及底部重复协议入口；复用已有openLegal进入完整协议页，CSS、JS、勾选与服务端同意逻辑、法务正文均未修改。现有customer-pages+tooling针对性16/16通过，production build仍85文件、16WXML/17WXSS。已告知主控后连接原生SDK，实际点击两链接分别到terms/privacy，回读正式v1及正文1005/3264字符、0error/0JS异常，返回后accepted仍false；未勾选、提交同意、登录或发短信。4张真实PNG与report.json在evidence/devtools/settings-legal-links，已视觉检查协议卡片截图；验证结束disconnect并交主控预览。旧证据保留，未覆盖历史记录。
