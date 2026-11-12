# 宁达后台重做第一阶段实施计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 或 superpowers:executing-plans，按分配文件实施及独立审阅。用户已授权生成计划后直接施工，无需重复询问实施方式。

**Goal:** 暂缓实名后保持申请与人工审核贯通，归并后台已实现模块，修复指定订单工单联动。

**Architecture:** 现有四入口和独立 API 兼容增量。通过显式身份政策及版本化快照表达未做线上实名，资格审核继续独立有效。

**Tech Stack:** React/Vite、NestJS、Prisma/PostgreSQL、原生微信小程序。

**Spec:** ../specs/2026-10-31-admin-rebuild-design.md

## Global Constraints

- 仅本项目写入；旧源码只读，旧数据库不得用于测试。
- 金额整数分；RBAC、归属、版本、幂等、回调校验不可省略。
- 不改原样小程序副本；真实版视觉保留，生产不回退 Mock。
- 不输出密钥、不提交既有他人修改、不推送；主控统一根依赖和锁文件。
- API数据库测试只允许本项目本地 loopback:55432/chundian_test，测试进程串行。

## Review Focus

- 未知/缺失 identityPolicy 不得被客户端解释成人工政策；服务端未知配置拒绝。
- 资料缺失、他人附件及旧版本仍拒绝；人工待审不等于线上实名通过或可交付。
- 历史 v1 快照不改写，尚未确认跨政策申请显式要求重新审核。
- 导航归并不能扩大岗位权限；旧有效深链仍可回读。
- 多订单客户的救援/事故绑定所选订单，不依赖服务端任取一单。

### Task 1: API 人工资料政策

Files: apps/api/src/customers/identity-policy.ts（新增）、customers/profile.ts、common/config.ts、esign/native-signing.ts，必要的身份只读投影与对应 test。不改 schema、迁移及无关财务/合同规则。

Interfaces: customerIdentityPolicy(env=process.env): 'MANUAL_REVIEW'|'PROVIDER_REQUIRED'；profile.readiness.identityPolicy 与 public/identity-config.identityPolicy。v2资料快照具有 identityPolicy:'MANUAL_REVIEW',identity:null；v1保持原样。

- [x] 先写失败用例：人工政策资料完整可提交、未实名值为false、无供应商读取依赖、缺资料与越权附件拒绝、旧快照解析和跨政策冲突、误开供应商开关也不能新实名。
- [x] 实现政策解析、profile就绪/快照及实名入口总门禁；保留资格/风控门禁。
- [x] 运行相关单元与隔离数据库测试、API typecheck；记录红绿证据，独立审阅。最终13文件85项全部通过、零跳过；另终止专项22项通过。修复审阅发现的跨政策幂等回放，以及回归发现的已正常归还车辆终止档案读取缺陷。

### Task 2: 小程序人工审核提示与工单关联

Files: apps/miniprogram/src/pages/profile/index.js/index.wxml、services/api.js、相关tests；仅必要文案改动。

Interfaces: 消费Task 1 readiness.identityPolicy；未知值不放行、不自造资料状态。submitService(input)显式传递所选orderId。

- [x] 先写人工政策页面/提交/补件不请求供应商用例，及普通救援、事故保留orderId用例。
- [x] 实现人工提示与办理入口关闭，保留登录/协议/付款/分类证件及输入会话保护。
- [x] 运行小程序测试、构建与原样副本哈希核验；独立审阅。458项全部通过，111文件构建，109文件/2原样副本一致。

### Task 3: 后台已实现功能归并

Files: apps/admin/src/modules/navigation.ts/workspace.tsx、App.tsx、相关导航/布局/历史入口tests、必要CSS。

Interfaces: 现有route key和API维持；moduleForRoute返回新归属；navigationFor继续按岗位和服务端permissions过滤。

- [x] 先写新模块归属/权限/历史深链用例，核对既有partner-entry失败原因。
- [x] 保单/合作商归入车辆；账单/收退款/押金归入财务；通知归入订单；名称按需求统一。尚未实现商品不造假入口。
- [x] 保持紧凑单行导航分组，修复不再适配的旧模块假设；运行后台全套测试、typecheck/build及页面布局核验。272项全部通过、零跳过，1440/390布局和独立审阅通过。

### Task 4: 主控整合及后续细化

Files: docs/api-contract.md、.env.example、deploy/ninda/README.md、本设计/计划及后续产品/资产/变更专项计划。

- [x] 同步接口、环境政策及上线说明，不更改真实配置或执行真实业务。候选配置生成器11项通过。
- [x] 审阅前三项改动及测试证据，补齐本阶段跨入口核验；独立复审均通过。
- [x] 从固定参考提交提取产品及资产规则，逐项确认会改变价格/履约的差异，建立下一阶段计划 `2026-10-31-product-goods-and-swap.md`。完整新模块及线上四入口验收仍待后续完成。

本计划只涵盖可独立验证的第一阶段，不代表整体需求或上线完成；其余模块继续在主需求范围内。
