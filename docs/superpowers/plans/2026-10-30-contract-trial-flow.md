# 试运行合同与取消流程实施计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 按下方文件归属实施；用户已授权直接施工，不重复申请设计批准。

**Goal:** 合同由单名有权限运营按步骤完成，取消复用合同流程，资金以表格高效查询。

**Architecture:** 保留现有模型与路由，新增预览确认和明确归档命令；串联事实投影与前端当前步骤共用。无数据库迁移，部署以当前冻结生产源码为基线。

**Tech Stack:** React/TypeScript/Vite、NestJS/Prisma/PostgreSQL。

**Spec:** `docs/superpowers/specs/2026-10-30-contract-trial-flow-design.md`。

## Global Constraints

- 仅写当前项目；不重置已有修改，不提交别人文件、不推送旧系统。
- 协议可同人办理；资金、身份、保险权限不扩张。保留整数分、归属、版本、事务和幂等。
- 仅归档版本放行支付/交付；同人审核不代表自动批准。
- 模板固定到版本；预览确认绑定源文件；REVIEWED不等于ARCHIVED。
- 不操作真实签署、审核、资金和取消命令。生产只读核验。

## Review Focus

- 旧SUBMITTED/ARCHIVED版本无预览记录保持历史兼容，不自动过审；旧SUBMITTED终止协议若缺少原合同来源快照，须退回并补正。新DRAFT不可绕过前序。
- 模板换版/源文件重生成/交易条件变更后不会批准错误文件。
- 已签历史不能改报未签；资金和最终取消守卫保持一致。
- 失败读取/409后禁写、保留输入；切订单不能显示旧响应。
- 资金点击金额进入正确本单记录，后退还原分类与位置；窄屏不横向撑破页面。

## Task 1：合同后端串联

Files: `apps/api/src/offline-documents/{archive.service,archive.controller,schemas,review,command,field,workspace.service}.ts`、新流程辅助文件及相关测试；客户合同投影按需同步。

- [x] 先测试同人审核、无保管信息、新草稿前序守卫、REVIEWED不可付款、明确归档及快照变化、历史兼容。
- [x] 增加confirm-print和archive端点；review通过只到REVIEWED，archive承接原放行副作用。
- [x] 元数据移除保管要求，OWNER合作档案审核复用write能力；更新FIELD服务和客户状态文案。
- [x] 运行隔离测试及API构建；提供精确改动清单。

## Task 2：取消串联

Files: `apps/api/src/offline-documents/cancellation.ts`、`apps/api/src/orders/cancellation*.ts`、`apps/admin/src/order-offline.tsx`、`order-cancellation-model.ts`、专用CSS与测试。

- [x] 先测试单人确认、历史签署事实、未签跳过、UNKNOWN阻断和资金守卫不变。
- [x] 新确认直接保存有效核实，旧SUBMITTED可同人确认；附件选填。readiness去掉parallelGroup，后序动作按前序禁用。
- [x] 取消页单步展开，已完成可回看、后序不可启动，终止协议复用ArchiveDetail。
- [x] 单元及浏览器回归，保持当前读失败/版本隔离。

## Task 3：合同串联UI

Files: `apps/admin/src/contract-center.tsx`、`order-contract-panel.tsx`、`process-guide-model.ts`、新流程模型/CSS与浏览器测试。

- [x] 先测试生成→预览确认→上传/审核→归档的解锁及同人操作。
- [x] 当前步骤一块内容，去除大段叠加卡片、保管项及双人提示；明确当前模板版本。
- [x] 主合同和终止协议使用同组件；列表/详情读取、补正和历史查看保持。
- [x] 浏览器验证1440/1366/390尺寸、拒绝与读失败，完成类型检查。

## Task 4：模板启用与资金表格（主控）

Files: `apps/api/src/operations/admin.ts`及模板命令辅助/测试；`apps/admin/src/resources.ts`、`form.ts`按需；`order-record-panel.tsx`及表格样式/测试；FIELD UI文案。

- [x] 先测试模板启用权限、固定版本/内容、幂等、同类型单一启用；已启用正文不可修改。
- [x] 增加后台启用动作，旧模板保留历史，不自动发布新文案。
- [x] 资金按账单/支付/退款表格展示，金额为详情入口；复用原详情办理逻辑，返回恢复表格位置。
- [x] FIELD移除保管项和独立复核提示，保持后端一致；不改客户小程序发布版本。

## Task 5：整合与发布

- [x] 独立审查各任务与跨模块边界，必要回归、API/admin构建及五视口验收。
- [x] 更新API约定/操作指引，冻结差异；按新生产基线准备可回滚发布，保留渠道与自动账单配置。
- [x] 发布后核对静态/API版本及目标订单取消事实；不执行取消/审批/退款。

## 进度与裁定

- 已完成现状勘察。当前分支codex/independent-miniapp-platform包含连续已上线未提交改动，沿用当前工作区；以冻结源码比对控制本次发布范围，不另建旧HEAD工作树。
- 2026-10-30：同人协议审核仅用于线下档案/模板/取消签署核实，不改变退款与客户资格审核。

- 恢复路径裁定：REVIEWED后允许建立补正版本，保留旧审核记录；归档仅接受最新版本且无后续候选，防止条款变化后既无法归档又无法重做。

## 追加任务：终止明细和三方合同第二版

- 已实现终止原因、时间、原签合同关联、还车事实/计划、违章、应补/应退金额与日期、保留款及未决事项表单及专用打印。
- 独立审查要求：打印引用和车辆事实冻结；矛盾交付证据不得打印为未交付；历史反馈可处理而历史正文不可编辑；资金表格下钻应保留原支付退款申请入口。
- 三方合同按20260713两方版本逐条整合，保留现行已确认商业政策；审阅包位于`docs/legal/drafts/ninda/offline-mvp-v2`。完成正文/JSON一致性、变量与实际PDF兼容性检查，用户审定前不启用。
- 发布前再次冻结全部差异、进行独立复审及实际构建。此前未完成的完整admin回归按文件串行复核，不因并发超时或旧布局断言漂移削弱业务保护。
- 主控串行admin全套264/264、API相关107/107通过；最终补正及终止后端30/30、前端流程18/18通过，均无跳过。API/admin构建及冻结发布构建均通过。上述为分批回归，不将有重叠的测试数相加。
- v2订阅合同与终止协议已录入生产DRAFT，未启用；其正式正文仍待用户审定。已有生效补充协议时阻断自动生成，本版不提供人工勾选跳过或自动合并。
- 2026-10-30 13:01北京时间：代码版本`20261030-contract-trial-v1`上线，公共核验14项通过，123张表业务保护核验通过，目标订单未推进。见`docs/evidence/ninda-contract-trial-flow-20261030.md`。待用户审定v2文本后才办理正式模板启用，此项与代码发布分开记录。
- 2026-10-30后续闭环：用户明确批准两份正文及差异。模板启用接口暴露锁函数void返回值兼容问题，真实隔离数据库先复现、再修复，通过6/6回归及构建；13:17发布`20261030-template-lock-v1`，全部静态资源保持原样。两份v2随后正式启用并独立回读确认，同类型v1退役但原签合同和档案保留。见`docs/evidence/ninda-template-activation-repair-20261030.md`，法律文本启用待办已完成。
