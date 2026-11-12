# 产品工作台电池筛选实施计划

**Goal:** 按电池买断/BaaS及规格筛选车辆，列表显示同源字段，右侧宽度增大。
**Architecture:** 复用车辆资产的 batteryOwnership、batteryCapacityKwh。现有分页接口新增容量精确匹配；选择车辆ID、产品定价和适用车型逻辑保持现有规则。
**Tech Stack:** React/TypeScript、NestJS、Prisma。
**Spec:** 本轮用户截图及明确要求；沿用已授权直接施工流程。

需求充分明确，采用现有接口扩展，不增加独立页面。电池方式选“电池买断”或“BaaS租用”，空值表示不限制；容量按kWh输入，允许最多三位小数。字段未登记时显示“未登记”，不猜测。车型级匹配仍覆盖该车型所有车辆；本轮条件用于选择具体车辆，沿用现有说明。

文件范围：admin的 product-vehicle-selection.ts、product-vehicle-picker.tsx/.css、product.css 及对应测试；API vehicles/admin-query.ts及vehicle-ledger-filters测试；docs/api-contract.md。

- [x] 在线上冻结源码隔离副本写后端组合筛选、前端参数/交互反例，确认失败。
- [x] 实现容量精确筛选，表单两项和列表两列，左右比例由42.5/57.5改约35/65。
- [x] 验证全选、分页、重置、未登记显示、权限和范围组合；构建及桌面/窄屏布局核验。
- [x] 只发布本次变更，保持现有资格修复和其他业务；CAS合并根目录并记录验证。

发布基线：20261106-qualification-continuity-v1；仅新平台，原根工作树未发布修改不混入。无schema迁移、无业务数据修改、无真实交易。

验证：API组合筛选5/5、电池投影3/3、前端筛选及真实浏览器选择交互6/6、完整产品工作台/仓库交互1/1通过。完整页面在1440、1920和390宽度检查；电池两列提前至品牌/车型之后，1440无需横向滚动即可看到，保存操作保持可见。第一次布局用例因合成车辆改名而仍使用旧选择器失败，修正测试选择器后通过。API在隔离Docker内完整生成与构建，admin类型及构建通过。

发布：2026-11-06，`20261106-product-battery-filters-v1`；API镜像 `sha256:965e4a695b390d511ef029e396736567f20ffd67fb6597114aa059adbe8427bc`。健康、53文件静态清单、配置校验通过；数据库仍为77项迁移，无schema变更。服务器只读实际查询核对BaaS75/100/108/102kWh和买断70kWh共5种组合，返回数量与独立数据库统计一致，翻页不重复。全部9文件CAS合并，无冲突。运行证据在 `.runtime/product-battery-filters-20261106/reports/`，截图在其 `layout/` 子目录。
