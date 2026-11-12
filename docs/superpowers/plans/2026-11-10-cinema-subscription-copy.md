# Cinema Subscription Copy Revision Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for the small, already-authorized content revision. Steps are tracked below.

**Goal:** 将既有 12 组广告词调整为用户指定电影与短句启发的中文原创文案。

**Architecture:** 只替换共享文案表的 11 组字符串及 id，不更改轮换选择器和页面绑定；完整保留第一组。

**Tech Stack:** 现有 JS/WXML/WXSS、node:test、WCC/WCSC 与离线浏览器排版检查，不加依赖。

**Spec:** `docs/superpowers/specs/2026-11-10-cinema-subscription-copy-design.md`

## Global Constraints

- 保留 12 组数量、唯一 id、标题至多 9 字（含标点）。
- 只改文案文件与本轮设计/核验记录；不修改页面、接口与固定业务提示，不覆盖旧发布包或旧证据。
- 重要业务逻辑未变；本轮纯字符串修订复用现有测试，不新增镜像文案的测试。

## Review Focus

- 标题与小字同组；电影气质与宁达选车动作衔接自然。
- 原创文案不冒称原台词，不引入未经验证的产品承诺。
- 320/390/430px 下标题单行、小字不横向溢出，原轮换行为保持。

### Task 1: 文案替换与核验

**Files:** 修改 `apps/miniprogram/src/utils/subscription-copy.js`；本轮记录与证据放在 `.runtime/cinema-copy-20261110/`。

**Interfaces:** 保持 `subscriptionCopies` 与 `nextSubscriptionCopy(currentId)` 的导出和每组 `id/title/lines/catalogDescription` 结构。

- [x] 保存修改前文案快照；写入 11 组新文案并保留原组。
- [x] 运行已有 `subscription-copy.test.cjs`、源码检查与模板编译。
- [x] 在实际编译模板上核验 12 组 × 2 页 × 3 宽度，并目视代表截图。
- [x] 记录完整文案与核验结果，说明本轮源码修订的交付状态。
