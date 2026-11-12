# 首页与选车页轻量操作样式

日期：2026-11-10。依据本轮用户两张真机截图与明确的视觉反馈直接实施。

## 已实现

- 首页“查看订单”等下一步入口为右对齐文字箭头；“查看可订阅车辆”为自然宽度的白底细边框按钮。
- 选车搜索为透明底文字操作；品牌筛选用浅暖底和细边框显示选中；“查看方案”取消黑色块。
- 底部四项导航选中态使用浅底与短黄色标记，图标、文字、原生路由和既有动效保留。
- 首页和选车的操作控件最小点击高度 44px，包括窄屏文字入口与错误重试按钮。其他页面的主要业务提交按钮保留现有层级。

只改五个真实版文件：`src/app.wxss`、`src/pages/home/index.wxml`、`src/pages/home/index.wxss`、`src/pages/catalog/index.wxss`、`src/custom-tab-bar/index.wxss`。相对本轮基线，所有 JS、API、事件处理器、数据、路由和业务条件均未改；原样参考副本未动。

## 核验

- `node apps/miniprogram/scripts/check.cjs` 通过。
- 冻结包使用官方 wcc/wcsc 编译：22 WXML、23 WXSS 通过。
- `catalog-plan-availability.test.cjs`、`tab-navigation.test.cjs`、`customer-pages.test.cjs`：29/29 通过。
- 实际编译页面与实际 custom-tab-bar 在 320/390/430px 的 10 种状态共 30 场景通过；覆盖首页有/无待办、加载/错误，选车默认/选中品牌/长品牌与车型金额/加载/错误/空数据。无页面横溢出、底部内容遮挡或脚本错误。长品牌为正常横向滚动。
- 浏览器检查全程阻断外网，使用示例记录及本地车辆示意图；桌面安全区为零。不能替代真机检查。
- 独立只读代码审阅无阻断问题，确认全局改色只影响目标浏览/筛选类，并复核窄屏规则作用域。

微信开发者工具在独立 QA 副本、独占 9436 端口运行，读取真实首页与选车数据，无业务写入。两页 `loading:false/error:''`，运行异常为零；首页浏览按钮白底、选车搜索透明、选中品牌 `rgb(255,249,230)`，均高 44px。SDK 首次冷启动连接和后续选车截图请求超时：首页原生截图已有，选车截图未取得，因此原生截图验收记录为部分完成。设备型号为模拟 iPhone 14/15 Pro Max，SDK 3.17.6；并非真机验收。

## 包与交付

冻结目录：`.runtime/releases/20261110-miniapp-light-controls/miniprogram`。

- 基线为 `20261110-profile-documents` 预览，精确覆盖本次 5 文件；129 文件全部校验。
- manifest SHA-256：`39e04e26e3be306e186493a21927dd03612cfe6f1270fb952a96d60e5ef58f83`。
- project.config SHA-256：`ac9c22120fa71133d88c2f064d2467061b4717b297933ee9c588c39429865b34`，保持原配置及 `urlCheck:true`。
- 官方 CLI 预览成功，包总大小 1,240,706 字节。未上传开发版本、未提审、未发布；此前 1.3.0 暂停正式发布要求持续有效。

预览码：`.runtime/releases/20261110-miniapp-light-controls/preview/preview.png`。

视觉并排图：`.runtime/miniapp-light-controls-20261110/visual/after-final/overview.png`。改前/改后对比：同目录上级 `compare.html`。

预览回执：`docs/evidence/miniapp-light-controls-preview-20261110.json`。运行、截图与验收材料在 `.runtime/miniapp-light-controls-20261110/`；最终源文件与证据绑定记录为 `docs/evidence/miniapp-light-controls-final-20261110.json`。
