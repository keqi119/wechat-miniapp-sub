# 纯电主义真实微信小程序

Node >=22；依赖由仓库根目录 `pnpm install` 统一安装。

- `pnpm --filter @independent-platform/miniprogram test`：真实 adapter、页面边界和编译工具测试。
- `pnpm --filter @independent-platform/miniprogram build`：检查并编译 WXML/WXSS，输出 `.artifacts/production` 原生源码包。
- `node apps/miniprogram/scripts/verify-reference.cjs`：核对原样副本和来源 SHA-256。
- 原样 Mock 和原有测试在 `reference/miniprogram-mock`；本包 src 不包含 Mock 数据或场景切换。

`src/config.js` 指向新生产 API。仅本地联调可手动改为 `http://127.0.0.1:3101`，生产 build 将拒绝本地地址。禁止写入 AppSecret、支付或法大大密钥。

原 15 页面、4 Tab、12 PNG 和原页面 WXSS 保留；新增电子签署承载页。账户页提供微信手机号授权和短信登录，短信登录同时取得 wx.login 凭证以绑定当前小程序 OpenID。客户请求携带 Bearer，公开目录与协议匿名读取。附件通过 wx.uploadFile 上传后提交 fileId；私密文档通过鉴权下载读取。

支付 native 返回后查询服务端；应用再次显示会恢复未完成支付查询。签署 WebView/供应商小程序返回后查询服务端状态；URL 必须匹配已核验并注册的 signingHosts。当前 allowlist 为空，需完成供应商账号与微信业务域名核验后配置。不能用猜测域名放行。

`evidence/page-comparison` 保存原 15 页的 30 张离线对照截图及报告。复现：运行 `node apps/miniprogram/scripts/compare-pages.cjs` 后，在另一终端运行 `python apps/miniprogram/scripts/capture-pages.py`（需 Playwright 和 Edge）。这是以合成展示模型驱动实际 wcc 模板的浏览器排版核验，无真实 API、微信、支付或签署能力声明。

构建结果仍需用当前微信开发者工具导入、核验合法域名及隐私能力、真机验收。正式文案发布、真实扣款和签章测试需要主控明确范围。
