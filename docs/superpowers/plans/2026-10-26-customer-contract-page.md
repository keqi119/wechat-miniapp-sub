# 客户合同详情与进度 Implementation Plan

> For agentic workers: 使用 subagent-driven-development 分配独立目录，主控整合审查及部署。

**Goal:** 客户能看懂合同条款摘要、当前签署进度和下一步操作，签后明确等待车主或归档。

**Architecture:** API 将已冻结交易条款和可信签署事实转换为只读 contractDetail v1；原生小程序在现有 record 路由渲染合同专用界面。原签署端点保持全部校验。

**Tech Stack:** NestJS / Prisma / TypeScript，原生微信 JS/WXML/WXSS，已有 WCC/WCSC 检查和 DevTools CLI。

**Spec:** ../specs/2026-10-26-customer-contract-page-design.md

## Global Constraints

仅本项目写入，旧库不连接，金额整数分；客户归属、RBAC、版本、事务幂等和回调校验不省略。原样 Mock 不改，生产不回退 Mock。密钥不输出/入 Git/前端。不执行真实签署或支付。工作区包含既有并行改动，按上线清单精确冻结差异，不提交别人文件、不推送。

## Review Focus

- 客户已签而合同 PENDING：必须等待车主，不能再次显示签署。
- 已尝试但无可信结果：先查询原交易，不通过换文案再次签署。
- 源文件/任务/客户/订单/hash 不匹配：不泄露文件、不开放动作。
- 准备与复核阶段、拒签过期及未归档终态：不同界面不能前后矛盾。
- 老平台与补充协议兼容；小屏、长主体、零押金、一分金额及缺 DTO 不失真。

## Tasks

- [x] API：在 apps/api/test/customer-contract-view.test.ts 先写失败用例，覆盖以上阶段和数据隔离；实现 orders/customer-contract-view.ts，并接入 customer.ts、customer-order-view.ts；修正相关旧断言。输出 DTO 严格按设计，只读且不调用供应商。
- [x] 小程序：先写 customer-contract*.test.cjs；在 utils/customer-contract.js 校验 DTO，在 pages/record/index.js/wxml/wxss 增加专用合同分支和浮窗动作。必要时 services/api.js 仅加显式查询包装。保留其他 record 类型。底部留安全区，未知 DTO 不用通用动作兜底。
- [x] 独立审查：核对绑定、签署及查询边界；运行小程序全套与 API 相关测试/typecheck；用实际 WCC/WCSC 合成各阶段，在320/390宽度检查布局和按钮。
- [x] 发布：从当前API源清单及1.0.6冻结包派生新包，排除无关改动；秘密扫描、上线前快照与备份、部署只读展示API；线上读取真实合同验证客户已签后的阶段。API开关、H5/admin静态及业务数据保持。
- [x] 以用户确认的keqi_119 DevTools会话上传1.0.7，核对上传前后哈希；体验版设置另记实际确认。更新指南及交付证据。

## Rulings

- 沿用当前项目分支和分工目录，保留未提交修改；发布隔离通过精确上线基线的独立构建目录实现。另开空分支会丢失已上线但未提交源码。
- 允许当前页面主动查询渠道并回读；普通加载仅读取持久化事实，不把查询当签署发起。
- 本轮不改授权、主合同内容、用章模式或线下合同规划。

交付记录：2026-10-26 17:11 API真实控制器只读回读确认双方签署归档；1.0.7上传成功且用户已确认设为体验版。小程序299/299、冻结相关77/77、API相关34/34及build通过。API首轮完整537项为523通过/14失败，修复源文件空值防护并补齐独立本地technical_acceptance_test既有缺列后，所有失败文件已顺序复验通过（技术15/15）；未重复运行全套。布局及独立审查通过，生产备份已校验。真机体验由用户继续验收，未代签或付款。后续支付入口反馈转入2026-10-26-customer-payment-entry.md。
