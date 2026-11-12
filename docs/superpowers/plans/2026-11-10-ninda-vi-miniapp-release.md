# 宁达 VI 小程序视觉版发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Continue inline; one fresh scoped release review at the end. Steps use checkbox (`- [x]`) syntax.

**Goal:** 将用户确认的 V2 样稿落地为真实小程序，保留个人资料已确认布局，完成核验、上传及微信正式发布流程。

**Architecture:** 保留原生四 Tab 路由与现有业务控制器。共用主题样式统一视觉，自定义 tabBar 承载选中黄色整块与轻水波；目标页面用定向水平入场表达翻页，保持微信原生路由缓存、返回与接口刷新。不会为动画将四个真实页面合并为新的业务容器。

**Tech Stack:** 原生 JS/WXML/WXSS，现有 Node tests、wcc/wcsc、微信开发者工具 CLI/自动化，微信公众平台版本管理。

**Spec:** `docs/design/miniapp-20261110/ninda-vi-rams-v2/design-tokens.json` 和 `ninda-navigation.html`。2026-11-10 用户明确“同意按照这版发布”，批准实施与发布，取代此前个人资料计划仅生成预览的限制。

## Global Constraints

- 沿用当前 `codex/independent-miniapp-platform` 连续施工目录；逐文件冻结开始基线，不覆盖已有成果、不混合提交/推送。只写本项目。
- VI 黄 `#FCC900`；主要操作黑灰 `#231815` / 白字；辅助字 `#65615C`，背景 `#F5F6F7`，卡片白色，原有尺寸/圆角/栏目和操作位置不扩张。
- 底部仅选中项黄色底块同时包住图标和文字；180ms 低对比水波；220ms 水平页面入场，目标在右则从右进入，目标在左则从左进入。黄色选中块即时更新；重复点击当前页只有水波；减少动态效果时即时显示。
- 手机号、已实名姓名/身份证锁定、资料即时保存、补件/驾龄/驾驶证、金额整数分、客户归属、支付签署状态和服务端门禁不改变。
- 真实图片继续由 API 提供；样稿中的合成身份/订单和示意照片不进入生产。首页使用提供的完整 VI 标志，不变形、不裁切。
- UI 主链出错不能吞掉反馈或阻断导航；异步回调不能复写后续选中状态。无新增后端 API、数据库迁移、真实签章或支付操作。
- 新目录构建冻结包，核验独立 API/AppID/文件摘要；使用新版本号，以微信实际上传/审核/发布结果分别记录，不把上传称为生产上线。

## Review Focus

- 第一次打开和从详情返回：自定义导航与真实路由保持一致，不错误重播翻页。
- 连续多次点击、同页点击、switchTab 失败：最终选择正确、允许重试，不停在错误的选中态。
- 不同登录会话和接口错误：保持原客户隔离/刷新保护；账户页在已登录的业务请求失败时仍能进入本人资料，但不显示旧业务菜单。
- 长中文/金额、288/320/390/430px、安全区和减少动态效果：按钮可触达，底部不遮挡，标签不溢出。
- 编译、打包和微信运行中的自定义组件文件齐全；包内无样稿模拟数据，无账户或签约能力变化。

## Task 1: 统一视觉及账户页回归

**Files:** Modify `apps/miniprogram/src/app.wxss`、`pages/home/index.wxml` / `index.wxss`、`pages/mine/index.wxml` / `index.wxss`；Create `src/assets/ninda-wordmark.png`；主题直接追加至 `app.wxss`（编译器约束裁定见 ledger）。必要时调整具体页面同名样式以符合确认色值，保留语义不同的错误/禁用状态。

**Interfaces:** 已有业务事件与页面 data 结构不变；原个人资料两卡片/三行/角标/即时保存继续使用。

- [x] 冻结当前源码与测试基线，记录已知 suite 失败。运行现有 `mine-login-entry.test.cjs` 看见已登录错误态无法访问资料的失败。
- [x] 复用主题样稿的选择器和色值落地；替换首页被裁切标志，账户头像改用既有 person 图标；只调整错误分支的资料卡可达性，业务菜单仍隐藏。
- [x] 运行相关业务测试与源码检查/模板编译；用真实编译 WXML/WXSS 对代表页及异常状态做布局检查。纯配色不增加源码文本断言测试。

## Task 2: 自定义底部导航与定向页面过渡

**Files:** Create `src/utils/tab-navigation.js`、`src/custom-tab-bar/index.{js,json,wxml,wxss}`、`tests/tab-navigation.test.cjs`；Modify `src/app.json`、四个主页面 JS/WXML、必要的现有测试装载器。

**Interfaces:** 导航模块提供 `createTabNavigation({switchTab,showToast,now})` 测试实例和生产单例；`request(index)` 请求路由、`onShow(page,index)` 同步真实页面/消费本次方向、`onHide(page)` 清理本页过渡；组件读取四个固定路径及选中状态。状态仅保存在内存，不能包含客户/订单资料。

- [x] 写并运行行为测试：四个正确路由、右/左及跨页方向、同页不路由、失败回滚可重试、连续点击串行且最后意图生效、外部路由/返回同步、过期回调不复写状态。预期新行为缺失时失败。
- [x] 实现导航协调器、组件安全区/整块选中/点按水波；在页面 onShow 同步真实索引并运行220ms目标入场，onHide 清理；保留原刷新和卸载行为。
- [x] 设置 `tabBar.custom:true`，完整保留四条 list 配置；原四页面根容器只增加过渡 class 和底部安全空间。
- [x] 测试 GREEN、check、compile；检查主页面错误/登录/回退/快速点击与减少动态效果。旧测试若装载器不支持新增 UI 模块，只补齐装载边界，禁止削弱业务断言。

## Task 3: 完整核验、冻结包和正式发布流程

**Files:** Evidence in `.superpowers/sdd/2026-11-10-ninda-vi-miniapp-release/`；release in `.runtime/releases/20261110-ninda-vi-miniapp/`；public receipt `docs/evidence/ninda-vi-miniapp-release-20261110.json`。

- [x] 运行完整小程序测试（Windows 不使用已导致 libuv 崩溃的 `--test-force-exit`）、check、compile。修复真实阻塞，明确记录环境问题。
- [x] 独立审阅本轮精确差异及此前个人资料未封版的相关变更；给 reviewer 指定范围/基线/Review Focus，不能混入整仓其它业务。修复重要问题并验证。
- [x] 调用现有 build/verifyMiniappPackage，冻结新目录及审阅摘要；不得执行会复用旧冻结包或旧后端发布的脚本。
- [ ] 官方开发者工具编译和运行核验、生成预览、检查公开页及导航；用户本人实名/支付/签章不代操作。
- [ ] 新版本上传后核对微信公众平台当前线上/审核版本，按用户发布授权推进新版本审核与正式发布。若微信审核、平台管理员确认或工具限制阻塞，准确说明当前阶段和必要下一步，不虚报上线。

2026-11-10 发布进度（由用户最新指令覆盖此前发布授权）：1.3.0 已提交审核，但用户明确该版本不能作为正式版发布。即使审核通过，也不得上线；本次未撤销微信审核。后续先继续已批准范围内的电子签人工验收，正式发布需另行完成候选版本整改、验收并取得用户授权。

## Verification commands

- `node --test apps/miniprogram/tests/mine-login-entry.test.cjs apps/miniprogram/tests/tab-navigation.test.cjs`
- `pnpm --filter @independent-platform/miniprogram test`
- `pnpm --filter @independent-platform/miniprogram check`
- `pnpm --filter @independent-platform/miniprogram compile:templates`

Expected: behavior tests and complete suite pass; component/source checks pass; every WXML/WXSS compiles; actual browser/DevTools evidence records screenshots and route results, not just source matches.
