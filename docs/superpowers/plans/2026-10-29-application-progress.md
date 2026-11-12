# Application Progress Implementation Plan

> **For agentic workers:** Use test-driven development in assigned files, then independent review. Prior direct-construction authorization remains applicable.

**Goal:** 运营打开申请就能知道当前阶段、并行/串行关系、阻断原因和下一步，并知道每次按钮后的真实结果。

**Architecture:** Admin专用ApplicationWorkspace聚合现有只读API；纯模型计算展示状态，复用现有审核/资格/信用表单，不新增审核业务状态。用户追加证件长期/日期要求，资格API补充两个longTerm标记并执行单个增量迁移。

**Tech Stack:** React / TypeScript / Node tests / Playwright。

**Spec:** `docs/superpowers/specs/2026-10-29-application-progress-design.md`。

## Constraints

仅本项目写入；保留连续施工工作区，不重置或提交他人文件。金额/权限/版本/幂等/独立审核继续由服务端执行。只对独立宁达平台调研和发布；不代用户审核或确认。API环境仅镜像/构建版本按发布更新，供应商配置保持。

## Review Focus

- 资格未提交但信用及方案已完成时，正确显示并行准备的剩余阻断。
- 历史APPROVED及旧信用/方案不代表当前可用；未知或读取失败不虚构已通过。
- 受理返回的投影可能隐藏候选，不能据操作返回值误清空已保存方案。
- 异步刷新/切申请/改资料不能混用旧响应或丢弃正在编辑的输入。
- 操作成功但刷新失败仍保留提交成功事实，不能引导重复提交。

## Tasks

- [x] Model：创建 `apps/admin/src/application-progress.ts` 与 `.test.ts`，先失败回归，定义阶段、任务、阻断、下一步及动作回执纯函数；确认5段主线与并行准备。
- [x] UI：创建 `apps/admin/src/application-workspace.tsx/.css`，整合App、DetailFrame、customer-risk/customer-profile。首屏进度/阻断/下一步，详情分区定位，按真实状态摆放/隐藏重复受理；动作完成回执与当前进度同步。先测试关键交互，再实现。
- [x] Validity：新增资格有效期纯函数及先失败测试；两证独立长期/固定日期，固定日期北京时间整日有效，旧ISO入参兼容，拒绝空缺/矛盾/无效日期。更新customers/types.ts、qualifications.ts、schema与单个迁移；admin两个资格提交入口和详情同步。验证既有权限、幂等与审核保护不变。
- [x] Verification：admin完整测试、生产构建、本地浏览器桌面/窄屏及故障/刷新场景；独立审查并修复发现。
- [x] Release：基于已上线final-plan-defaults版本，构建API与admin，保留field/H5及供应商配置；备份与恢复验证、唯一增量迁移及全部旧列值保留核验后发布。线上只读确认申请和页面，写入交付证据。

## Evidence

`.runtime/ninda/application-flow-20261029/application-before.json`：真实申请IN_REVIEW、候选DRAFT、信用VERIFIED、资格0条、风险PENDING。只读取得，未执行业务操作。
