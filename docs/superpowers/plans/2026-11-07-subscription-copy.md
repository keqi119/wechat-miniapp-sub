# Subscription Copy Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 首页与选车页进入和刷新时显示不同的成套订阅文案。

**Architecture:** 共享本地文案表与排除当前文案的随机选择器，页面刷新时更新展示字段；车辆仍读取现有真实服务，筛选不切换文案。

**Tech Stack:** 原生 JS/WXML/WXSS、node:test、现有 WCC/WCSC 与 Playwright 排版工具。

**Spec:** `docs/superpowers/specs/2026-11-07-subscription-copy-design.md`

## Global Constraints

- 只改真实小程序；保留当前视觉、固定业务提示及已有未提交改动。
- 共 12 组成套文案，标题不超过 9 字（含标点），不添加无依据的产品承诺。
- 不新增接口、依赖、数据库调用或发布动作；在当前 codex 分支以源码快照为基线增量编辑，不单独提交混有既有修改的页面。

## Review Focus

- 随机值接近边界时仍返回有效且不同的整组文案。
- onShow 与下拉刷新都切换，筛选只更新车辆与查询条件。
- 网络失败仍结束下拉动画，并保留真实错误。
- 多次/并行刷新不会影响现有请求版本与会话保护。
- 全部标题、小字在 320/390/430px 无横向溢出且与固定提示分离。

### Task 1: 成套文案及页面接入

**Files:**
- Create: `apps/miniprogram/src/utils/subscription-copy.js`
- Modify: `apps/miniprogram/src/pages/{home,catalog}/index.{js,json,wxml}`
- Test: `apps/miniprogram/tests/subscription-copy.test.cjs`

**Interfaces:**
- Consumes: 现有 `load(page, loader)`、`service.getHome()`、`service.getVehicles(params)`。
- Produces: `subscriptionCopies` 数组（`id,title,lines,catalogDescription`）与 `nextSubscriptionCopy(currentId)`；页面 `heroCopy` 展示字段。

- [x] 写并运行失败测试：页面多次 onShow/refresh 返回不同文案；两页 onPullDownRefresh 成功/失败均 stop；catalog 筛选保留文案/参数；选择器在 Math.random 为 0 或接近 1 时仍返回其他整组。
- [x] 实现 12 组文案、选择器、两页绑定和下拉刷新配置，保留 catalog 请求 token。
- [x] 运行新增测试和小程序全套测试；运行 check/build。
- [x] 用实际编译模板核验全部文案在三种宽度的排版，并查看截图。
- [x] 审阅相对本轮快照的差异；记录验证结果，不提交混有其他成果的文件。

### Task 2: 用户后续授权的体验版发布

2026-11-07 用户授权「按此方案实施，并发布体验版」。此授权扩展前文“不新增发布动作”的初始边界。

- [x] 核对最近上传的 1.2.7 包；将本轮 7 份文案文件覆盖到冻结包，排除无关的 records/use 页面 3 份改动；准备 1.2.8。
- [x] 在独立源码包重跑 587 项测试，并核对清单、AppID、API、密钥扫描和原生模板构建。
- [x] 使用官方开发者工具 CLI 生成预览并上传 1.2.8，保留唯一回执和包摘要。
- [ ] 在微信平台设体验版并核对；若浏览器安全机制阻断，保留真实状态并交付已上传版本，说明需用户完成的单步操作。

上传结果：2026-11-07 01:30（北京时间）1.2.8 开发版本上传通过，官方 CLI 退出 0，总包 750,908 字节。浏览器控制因无法可靠识别当前网址被安全检查中止，未尝试绕过；需用户在微信公众平台将 1.2.8 设为体验版。此步骤待完成，不将“已上传”记录成“已设体验版”。证据：`docs/evidence/subscription-copy-miniapp-20261107.json`。
