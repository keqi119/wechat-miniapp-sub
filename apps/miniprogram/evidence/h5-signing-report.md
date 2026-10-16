# 原生H5签约指引切片验证

2026-10-16。按用户选择改为同一现有host的新H5签约中心，仅修改apps/miniprogram。原Mock、API/admin、法律文案及此前冻结发布副本均未修改；没有添加或声称添加服务号菜单，没有承诺自动唤起小程序。

实名、主合同、延期补充协议、交接单四类入口统一打开小程序本地H5签约指引页。公开`GET /api/public/signing-config`须返回`mode=SERVICE_ACCOUNT_H5`、唯一固定`entryUrl=https://app.subauto.keybox.cloud/miniapp-sign/`和布尔enabled；未启用无复制按钮，配置无效/网络失败关闭入口。用户点击复制时再次读取配置，不能以本地固定地址绕过enabled。剪贴板内容仅固定公开链接，无token、手机号、身份证、业务ID、supplier signUrl或URL query/fragment；没有读取剪贴板或自动复制。

指引明确：复制公开入口→在微信中打开→以与小程序相同手机号短信登录→H5核对本人实名及正式文档自行签署→手动返回小程序查询。复制或返回不代表实名、签署、资金/交付/变更生效。账户设置移除实名姓名/证件号码输入与对应data字段，仅显示已有readiness及H5指引；原小程序一般协议同意、登录、支付、完整延期报价确认、交接事实确认和查看已签PDF继续保留。

已删除生产web-view、navigateToMiniProgram签署分支、supplier签署URL校验/任务缓存、实名register/verify发起方法及signingHosts空配置。原生不再POST主合同/交接/AMENDMENT sign，也不POST实名register/verify/refresh；AMENDMENT仍先fresh校验当前版本及canSign，然后只打开指引，不创建任务。旧含task/url的外链缓存会清理，恢复缓存仅kind/id。

签约指引页onShow与App前台恢复按kind回查：主合同/交接GET各自sign-status；延期先fresh详情，再按当前revision POST sync（不create）；实名仅GET readiness。API负责人明确POST实名refresh可能申请证书，因此此原生切片不调用它。主/交接仅服务端SIGNED且有signedFileId才显示双方签署归档，AMENDMENT也需合同SIGNED+归档；实名仅readyForSigning显示实名/证书就绪。未知kind/他人identity上下文拒绝，不降级到主合同；403/409/网络或缺归档清除屏幕成功状态，显示结果待核实。

验证：

- 新增12项H5行为回归，其中首9项先红后绿；后3项补充三kind错误/账户字段/前台恢复及复制防重覆盖。旧直接外链签署测试按新的授权行为修改，付款/确认等独立回归保留。
- 全包`npm test`124/124通过。
- `npm run build`88文件、16 WXML/17 WXSS真实编译通过。
- `node scripts/verify-reference.cjs`109文件×2副本，0差异。
- `node scripts/verify-h5-signing-layout.cjs`13种actual-wcc离线合成版面、13PNG、390×844，无横向溢出、JS异常或外部网络请求。覆盖四入口、未启用/配置错误、返回pending/signed、实名就绪、三kind查询错误和账户无实名输入。已目视主入口、禁用、延期错误与账户页面。证据`h5-signing-layout/report.json`。
- 源码核对无web-view、navigateToMiniProgram、实名身份输入、/esign/register|verify|refresh以及原供应商外链发起/缓存残留；构建检查和既有回归通过。

边界：所有配置启用、状态及账户均为离线合成fixture，未调用生产/开发业务API、真实剪贴板、SDK、短信、支付、实名、签署、预览/上传或生成二维码。公开配置实际enabled由后端开关及主控发布决定。此结果证明原生切片行为与编译/离线布局，不等同于H5新库SMS、法大大跳转或真实签后回调已验收。

最后文案收敛：按主控目视反馈，客户页面改为“复制签约入口”“在微信网页中签署”，移除固定公开地址、token/证件/供应商短链接等实现说明及H5术语；保留相同手机号登录、手动返回查询与未确认不能当成功的提示。此轮仅文案及对应离线fixture调整，无业务逻辑变化。重新运行12/12 H5专项、build（88文件/16 WXML/17 WXSS）及13种离线截图均通过，目视更新后的entry-contract.png无截断、重叠。此前124项全包结果属于文案调整前的完整验证，本轮未重复运行全包；截图/report.json为本轮更新证据。原生再次冻结。
