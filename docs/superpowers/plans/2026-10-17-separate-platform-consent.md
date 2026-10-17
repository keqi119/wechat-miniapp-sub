# 用户协议与隐私政策独立选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在账户设置中分别选择用户协议和隐私政策，避免一次点击合并表示两项同意，保留全文链接和既有签约授权。

**Architecture:** 继续使用现有原生页面和已发布文档接口，以两个独立页面状态形成当前文档版本快照。服务端协议及历史同意记录不迁移、不改写；新版业务文本审定发布属于后续步骤。

**Tech Stack:** 原生 JS/WXML/WXSS，Node test，现有 wcc/wcsc 模板编译。

**Spec:** `docs/superpowers/specs/2026-10-17-owner-marketplace-design.md` 第3节，用户已确认客户阅读并单独勾选平台用户协议，且此前授权生成计划后直接施工；继续既有独立项目功能分支实施，不新增批准步骤。

## Global Constraints

- 不修改原样 Mock、副本配置、正式文案、生产开关或已归档文件。
- 两项默认均不选中，登录和新版本确认需两项明确选择；实名、信用、签署、支付的专门同意保持独立。
- 协议通过链接阅读全文，不把全文铺在账户设置页面。
- 同一账户、相同版本阅读返回可保留本人选择；文档版本／内容改变、账户切换、退出或文档读取失败后清除选择。
- 使用已有 `services.loginWechat(code, snapshot)`、`loginSms(mobile, code, snapshot)`、`acceptConsents(snapshot)`；快照类型仍为 `{documentId, version}[]`。
- 当前单项是 UI 选择实现，不宣称新版条款发布、历史同意重新取得或全部车主系统完成。

## Review Focus

1. 只选其中一项及伪造旧 `accepted=true` 不能触发登录、短信发送或记录新版同意。
2. 阅览链接不自动选择；返回同版保留已选，变化后重新选择。
3. 客户或会话令牌变化不能继承前一人的选择；旧异步请求不能写入新会话。
4. 文档读取失败后不能继续使用旧文档选择发起新同意或登录。
5. 忙碌中及非法字段事件不能改变专门实名同意或其它页面状态。

### Task 1: 独立选择与所有入口联接

**Files:**
- Modify: `apps/miniprogram/src/pages/settings/index.js`
- Modify: `apps/miniprogram/src/pages/settings/index.wxml`
- Test: `apps/miniprogram/tests/settings-consents.test.cjs`

**Interfaces:**
- Consumes: `services.getLoginDocuments(): Promise<LegalDocument[]>`，按 terms/privacy 返回已发布文档；现有服务调用签名不改。
- Produces: 页面 `termsAccepted:boolean`、`privacyAccepted:boolean`；`consent(event)` 仅接受 `data-type=terms|privacy`，一次只修改对应状态；`consentSnapshot()` 同时核对两项及有效文档，失败抛错。

- [x] Step 1: 建立真实页面 VM 行为测试，覆盖五项 Review Focus；断言单项不触发服务调用，两项时仅提交当前文档 ID/版本，取消任一项立即阻止新操作。
- [x] Step 2: `node --test tests/settings-consents.test.cjs`，预期独立字段／单项控制测试失败，证明当前合并选择不满足需求。
- [x] Step 3: 实现两个字段、受控变更、版本/账户/失败重置；所有登录、短信和更新同意入口统一检查当前快照。两处 WXML 确认区分别渲染两个未预选复选框，并保留全文链接。
- [x] Step 4: 运行上述定向测试，预期全部通过；运行 `npm test`（小程序包），预期全部通过。
- [x] Step 5: 运行 `node scripts/check.cjs`、`node scripts/compile-templates.cjs` 和 `node scripts/build.cjs`，预期退出0。保存验证记录；本次不触发真实短信或上传小程序。
- [x] Step 6: 独立代码审查，必要修复按失败测试后修复；执行敏感信息扫描和 `git diff --check`，提交并推送现有功能分支。

## 后续模块

用户已将平台服务结构延至第二版。企业车主档案、合作附件审批、费用额度占用和线下付款台账暂停扩展；首版集中订单闭环。本计划不预先确定尚未填入附件的收费数值，也不替代这些模块的实现。
