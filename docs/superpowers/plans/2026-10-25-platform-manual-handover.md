# 宁达交接单法人手动签署实施计划

> For agentic workers: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task.

**Goal:** 用户完成交接事实及签署后，宁达法人在服务号业务合同页逐份签署并归档，无自动盖章。

**Architecture:** 扩展现有FadadaTask手动平台签署模式、法人H5交接接口与现有业务合同组件；保留平台双人审批和既有客户/车主签署。

**Tech Stack:** NestJS/Prisma/PostgreSQL，React/Vite，Node测试，法大大API2。

**Spec:** docs/superpowers/specs/2026-10-25-platform-manual-handover-design.md

## Global Constraints

- 仅写本项目；旧仓库及旧库不作测试；无真实交易、签署或代法人动作。
- 金额整数分；RBAC、CSRF、归属、哈希、幂等、回调验签、独立审批保持。
- 不改正式法律正文；API应用保留501040；宁达平台customer和章映射保持。
- 手动交接查询/回调绝不调用autoSealContract；旧任务不改变签署模式。
- 保持OWNER_AUTO_SIGNING_ENABLED=false、TECHNICAL_ACCEPTANCE_SIGNING_ENABLED=false。
- 当前工作区含已部署但未提交的连续施工内容，保留原分支工作区，冻结本轮前基线便于审阅，不从旧HEAD创建缺失现有实现的工作树，不提交/推送别人文件。

## Review Focus

跨企业授权；证书/法人/印章变化；审批过期/撤回；查询回调触发自动签；未知请求/重入改变文档或交易。

### Task 1: API与签署引擎

- [x] 先写失败测试覆盖spec中的业务边界。
- [x] 扩展FadadaTask冻结手动模式与本人确认记录，向后兼容迁移。
- [x] 修改平台网关，使手动交接查询只核验/归档；提供绑定本人、审批、同一任务的手动签入口。
- [x] 新增owner-h5平台交接列表/详情/PDF/sign/sync服务控制器，接入app DI/鉴权路径。
- [x] 必要时只为手动企业页补充signatureId参数，不修改自动授权行为。
- [x] 运行定向安全测试、现有电子签/法人H5回归及API编译。

### Task 2: 服务号业务合同入口

- [x] 先写路由、状态、确认绑定测试。
- [x] 使用spec约定的/handovers端点与原/contracts合并显示，保留类别/文件归属，不混用同ID请求。
- [x] 交接单标明交车/还车、客户和宁达签署状态，支持完整PDF、本人确认、局部反馈及同份继续签。
- [x] 运行H5全套测试、编译和移动布局检查。

### Task 3: 集成与生产

- [x] 独立review本轮增量，解决重要发现。
- [x] 检查生产无旧任务、现有印章/权限/策略保持；冻结代码配置，备份新环境。
- [x] 构建新镜像和H5，运行新增迁移，带回滚部署宁达环境；不变更旧系统。
- [x] 验证健康、部署hash、匿名拒绝、配置/业务数据保持、实际入口；无人工签署冒充验收。
- [x] 更新操作与证据，提供人工验收操作步骤。

验证结果：已部署 20261025-platform-manual-handover-v1；原业务记录及权限/印章摘要保持，公开入口与匿名拒绝校验通过。真实法人签署和交易由用户人工验收，未由代理执行。证据见 docs/evidence/ninda-platform-manual-handover-20261025.json。
