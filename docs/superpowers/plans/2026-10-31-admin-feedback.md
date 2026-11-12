# 后台反馈修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. 执行以本轮增量和独立复核为准，不提交既有无关文件。

**Goal:** 修正合作商车辆范围，统一新增抽屉/按钮，实现可管理多产品卡槽和车辆筛选批选，补齐车辆台账与分离保险/BaaS。

**Architecture:** 复用独立平台既有商品、产品版本和车辆关系，服务端提供精确筛选与只读台账投影，前端组件按车辆管理槽位。历史订单与内部兼容标识不迁移删除。

**Tech Stack:** NestJS、Prisma/PostgreSQL、React/TypeScript/Ant Design、微信原生小程序。

**Spec:** `docs/superpowers/specs/2026-10-31-admin-feedback-design.md`

## Global Constraints

- 仅本项目写入；旧仓库固定提交只读，不连接旧数据库。
- 金额整数分、RBAC、revision、幂等和物理车占用不省略。
- 原样小程序副本不改；真实版不回退Mock；小程序生产发布保持暂停。
- 根依赖、schema和部署由主控整合；代理只写已分配文件。

## Review Focus

- 合作过期/空车列表是否错误回退全车，列表与count是否同范围。
- 筛选翻页、快速切换、会话变化、筛选外勾选是否保留或清除正确。
- 第二个产品槽位是否仍锁定同一物理车，隐藏/停用不成为可申请选项。
- 未登记字段是否被推断伪装为事实，私人证件或协议是否泄漏到台账。
- 抽屉长表单的标题、内部滚动、底部确认、键盘焦点在窄屏仍可达。

## Task 1 合作商范围与车辆台账查询

Files: `apps/api/src/operations/admin.ts`、`apps/api/src/vehicles/` 新增查询投影/测试；必要的 `apps/admin/src/partner-simple.tsx` 及测试。

- [ ] 复现三合作商各一车但详情三车的失败行为，覆盖无关联车辆、无效筛选值、到期合作与计数一致。
- [ ] 修复实际查询层范围，增加严格车辆筛选参数及所有人/登记资料白名单投影。
- [ ] 验证接口行为、授权角色和列表/详情查询，不使用生产业务库测试。

## Task 2 商品多卡槽

Files: `apps/api/src/goods/{types,service}.ts` 和测试；`apps/admin/src/{goods.tsx,goods-model.ts,goods.css,vehicle-product-slots.tsx}` 和测试；`modules/navigation.ts`；真实小程序选择链路测试。

- [ ] 先测 vehicleId 精确过滤、跨页第二商品以及独立发布/下架。
- [ ] 提供 `VehicleProductSlots({vehicleId:string})`，全量分页读取本车槽位，新增固定本车商品，按钮“保存草稿”。
- [ ] 隐藏兼容套餐导航并交主控处理直接旧入口；验证小程序选择第二产品后的申请ID与价格来源及占车冲突。

## Task 3 抽屉、按钮与车辆详情

Files: `domain-ui.tsx`、`asset-shared.tsx`、`work-order-shared.tsx`、共享CSS及针对页面样式；`vehicle-workspace.tsx`、`resources.ts`、`asset-profile.tsx` 及测试。

- [ ] 定位估值抽屉根因并在实际App复现；修复共用布局和语义按钮，不仅覆盖截图。
- [ ] 所有人/登记信息接真实投影，保险与BaaS独立页签；商品页签嵌入Task2组件。
- [ ] 浏览器检查五个新增抽屉、车辆台账/详情、长内容滚动与权限失效，不做真实业务写入。

## Task 4 产品筛选批选（主控）

Files: `products.tsx`、新增 `product-vehicle-picker.tsx/.css`、`product-vehicle-selection.ts` 及行为/浏览器测试。

- [ ] 测试筛选参数、追加/取消结果与原选择保留、跨页全选、失败/超限原子保留。
- [ ] 接Task1查询，筛选结果表格多选；清楚展示匹配数量与已选数量，已选车型仍保持原适配语义。
- [ ] 验证POST仅包含所选真实vehicleIds及原产品配置，不自动创建商品。

## Task 5 集成、复核与交付

- [ ] 主控整合 `App.tsx`、接口文档与必要schema；运行相关测试、类型检查与构建。
- [ ] 交叉复核本轮实际增量，修复发现后重验必要项目。
- [ ] 准备新版本及可回滚部署，根据已有上线授权更新PC/API；验证公网静态文件与API，保留小程序生产暂停。
- [ ] 记录已上线/仅源码验证的准确范围，不把未执行步骤描述为通过。

## Task 6 用户追加：保障要求去耦（发布前完成）

Files: `apps/api/src/insurance/{types,service,coverage,controller}.ts` 与纯/真实DB测试；后台 `insurance.tsx`、`modules/navigation.ts`、`process-guide-model.ts`，主控 `App.tsx`、`operations/workbench-summary.ts`及测试。

- [ ] 先测无配置的有效已审核真实保单可以通过交付/续期保单门槛，缺保单、未审、过期、批改移车、退保、跨附件仍阻断。
- [ ] 草稿/提交/审核不要求绑定保障版本；新人工证据仅绑定本车专用附件。已存在审核记录不改，历史幂等按原body摘要回放。
- [ ] 退役管理/补核API与PC路由、导航、查询及流程提示，工作台不读取旧补核任务；到期续保提醒继续保留。
- [ ] 回归统一coverageAt所有消费者，明确不放松产品/资格/合作/物理占用/纸档/款项门禁；加入最终独立复核和新版本。
