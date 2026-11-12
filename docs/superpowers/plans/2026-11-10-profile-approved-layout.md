# 个人资料确认稿落地 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按用户 2026-11-10 确认的样式，把个人资料改为带大标题和说明的上下两卡片，并提供可验收的新预览码。

**Architecture:** 继续使用现有原生页面、可信身份投影和串行自动保存。只改 profile 的 WXML/WXSS，移除控制器内无用的 Tab 状态；不调整服务端、认证、上传、支付及补件接口。

**Tech Stack:** 原生微信小程序 JS/WXML/WXSS，Node test runner，现有 wcc/wcsc 编译器，官方开发者工具 CLI。

**Spec:** `docs/design/miniapp-20261110/profile-app-v3/profile-app.html`、同目录 `style.css` 和 `design-tokens.json`；用户本轮已明确“确认可行，开始实施”。

## Global Constraints

- 在现有 `codex/independent-miniapp-platform` 连续施工工作区执行；先保存本轮文件基线，避免遗失已有未提交成果。不得用旧 HEAD 覆盖当前代码，不混合提交或推送。
- 页面顶部保留现有“个人资料”大标题和按账户状态区分的说明，虚拟验收范围说明必须保留。
- 已实名个人信息按姓名、手机号、脱敏身份证号三行只读显示，32rpx 同字重。已实名角标使用 `#F9BE00`；不展示再次认证按钮或认证勾选框。
- 已锁定但实名依据暂不可读时继续锁定，只提供原结果查询；不能误报已实名或开放身份修改。
- 两张卡片同时显示，不保留 Tab。证件文字可查看，无长文件名；替换/移除同行，上传与移除沿用当前自动保存。
- 原 App 色值及圆角：背景 `#F5F6F7`，正文 `#231815`，辅助字 `#65615C`，文字按钮 `#5D4908`，卡片白色/24rpx 圆角，按钮 16rpx 圆角。
- 未实名的本人同意、正式协议版本、认证条件、结果查询保持；已同意的协议链接下移到页底且每类仅一个入口。
- 普通客户仍需驾驶证及驾龄；驾龄移入证件资料卡片，虚拟验收账户仍隐藏两项。补充申请、位置和备注流程保留。
- 底部联系客服与退出账户并列；不显示原电话号码行。后台、真实实名、交易及签章不由本轮触发。
- 只生成预览，不上传开发版本、不提审、不发布生产。本轮不改 API 或生产配置。

## Review Focus

- 已实名、已锁定但依据不可读、查询失败：身份不可修改，证件可办理，认证入口不重复出现。
- 未实名与协议更新：准确展示一个隐私政策入口，独立实名同意不能被普通协议同意替代。
- 自动保存网络未知、409、换号和迟到响应：原记录与本地草稿不能被错覆盖；已有保护测试必须通过。
- 普通客户驾龄、驾驶证与 NEEDS_INFO 补充：字段及显式提交入口可达，证件自动保存不代替申请提交。
- 320/390/430px、脱敏号及缺失证据文案：三行信息不溢出，证件两操作和底部两按钮保持同行。

## Task 1: 原生页面落地与回归

**Files:**
- Modify: `apps/miniprogram/src/pages/profile/index.wxml`
- Modify: `apps/miniprogram/src/pages/profile/index.wxss`
- Modify: `apps/miniprogram/src/pages/profile/index.js`（仅清理 Tab 状态/事件）
- Modify/Test: `apps/miniprogram/tests/profile-layout-feedback.test.cjs`
- Modify/Test: `apps/miniprogram/tests/customer-profile-flow.test.cjs`（查询入口改用无障碍名称定位，保留真实事件触发断言）
- Evidence: `.superpowers/sdd/2026-11-10-profile-approved-layout/`

**Interfaces:** 现有 `identityLocked`、`identityVerified`、`profile.identity`、`profileFiles`、`profileSaving` 等状态及原处理函数不改签名；WXML 复用所有事件。

- [ ] 保存上述 4 个文件基线及摘要；运行现有相关测试并读取结果。
- [ ] 将现有 Tab 交互验收改为两卡片同时可用；保留真实自动保存/私有预览断言。补齐已锁定但依据不可读、普通/虚拟驾驶资料、补件入口的编译可见性断言，先观察新要求失败。
- [ ] 重组 WXML：个人三行、认证/同意条件块、单独证件卡片及补件区域、并列底部按钮与单份协议链接。清理无用 Tab 状态和样式。
- [ ] 按确认稿统一颜色、字号、间距、圆角；完成态隐藏认证动作。登录、错误反馈等范围不扩展。
- [ ] 运行完整小程序测试、`check` 和模板编译；实际编译后的页面做 320/390/430px 布局核验。覆盖实名成功/失败、未实名、普通客户、补件、登录及错误重试。

## Task 2: 独立审阅与冻结预览

**Files:**
- Create evidence/scripts: `.superpowers/sdd/2026-11-10-profile-approved-layout/`
- Create package: `.runtime/releases/20261110-profile-approved-layout/miniprogram/`
- Create receipt: `docs/evidence/profile-approved-layout-preview-20261110.json`

**Interfaces:** 用本轮基线到当前文件的精确差异审阅；打包复用 `build()` 与 `verifyMiniappPackage()`，预览复用已验证的 `runRealCli()`。

- [ ] 一次独立审阅覆盖本轮所有源码差异及上述 Review Focus，修复有实质影响的问题，核验最终摘要。
- [ ] 在新目录构建冻结小程序包，核对真实 API 配置、AppID、文件集与摘要，不覆盖旧预览包。
- [ ] 官方 CLI 检查登录并生成新预览码；核对前后包摘要、CLI 结果、二维码和回执。
- [ ] 更新完成证据，向用户提供新二维码和简短验收指引；不进行开发上传或生产发布。
