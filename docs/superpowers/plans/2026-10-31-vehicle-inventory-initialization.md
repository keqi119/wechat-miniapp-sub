# 车辆库存初始化 Implementation Plan

> **For agentic workers:** Use subagent-driven-development for independent tasks; root owns schema, migration, integration and deployment. User AGENTS.md authorizes plan then direct construction; business ambiguities remain pending until answered.

**Goal:** 补齐用户指定字段并将已确认的83辆车、14组来源车型、83条BaaS资料草稿及合作商关系可靠初始化到当前宁达系统。BaaS含72条租赁资料及11条待补资料，46条起月明确、37条起月为空。

**Architecture:** 扩展原资产与BaaS领域，复用现有写命令/审计/幂等，私有导入预览与回读证据单独保存。

**Tech Stack:** React/Vite、NestJS/Zod/Prisma/PostgreSQL；原工作簿只读解析。

**Spec:** `docs/superpowers/specs/2026-10-31-vehicle-inventory-initialization-design.md`。

## Global Constraints

只写本项目；既有巨大未提交工作树继续按分配文件施工，不创建缺少当前改动的替代基线，不提交别人文件。金额整数分、真实日期、角色边界、双版本、幂等与审计必须保留。主控统一Prisma/根依赖及迁移；无旧业务库、真实交易/签章或微信发布。

## Review Focus

- 空值不变成0，导入初始里程不覆盖当前读数；资产payload明确省略与null行为。
- 财务/客户/H5/FIELD不能经新字段读取购车人或银行私密资料；API层验证投影。
- 表中订单号占位/浮点失真不能生成看似真实编号；原文仅待核来源。
- 同名车型不同年款、既有VIN和主体匹配必须可重复执行而不重复建档。
- 长期BaaS不得通过假结束日期实现；有限范围预览与状态守卫仍需约束。

### Task 1: 明确车辆资产字段

**Files:** API `apps/api/src/vehicle-assets/{types,service}.ts`及专用测试；UI `apps/admin/src/{asset-model,asset-profile}.tsx/ts`及专用测试；root `apps/api/prisma/schema.prisma`与新迁移。

**Interfaces:** 在原资产GET/PATCH新增 `engineNumber:string|null`、`bodyColor:string|null`、`initialMileageKm:number|null`、`purchaseAmount:number|null`、`purchaserName?:string|null`、`purchaseDate:string|null`、`nextInspectionDate:string|null`。精确限制见spec；FINANCE不返回purchaserName；普通当前里程不变。

- [x] 写失败测试：七字段录入/回读、空白到null、省略不改、初始与当前不同；非法分/日期/长度拒绝；财务无购车人且无写权；过期双版本与相同幂等回放。
- [x] 执行真实失败测试，记录失败原因；需要数据库的测试由主控使用隔离库，不使用生产测试。
- [x] 实现最小API与UI，复用原命令、角色及读回失败处理。
- [x] 主控加可空schema字段、兼容迁移/约束并生成客户端，在隔离库运行有关集成测试（11/11，零跳过）。
- [x] UI实组件验证输入、元分、只读回读、冲突保留及岗位；独立审阅无P1/P2。

### Task 2: BaaS资料与长期合同

**Files:** API `apps/api/src/vehicle-baas/{types,service,schedule}.ts`、`apps/api/src/asset-costs/source.ts`；UI `apps/admin/src/{asset-model.ts,asset-baas.tsx,vehicle-insurance-baas.tsx}`；root schema/新迁移；分别新增领域测试，不改Task1文件片段。

**Interfaces:** spec定义5个选填元数据字段、6个可空草稿基础字段和长期effectiveTo。详情返回missingFields；列表/车辆摘要不返回lessorCollectionAccountInfo。现有有限期16条款hash与旧无新字段请求摘要不变，metadata只影响revision/审计。

- [x] 写并执行失败测试：不完整草稿可保存；订单号空/前导零字符串；长期合同结束空与120期；缺条款不能启用/成本；非法正分/日期/域仍拒绝；私密账户不出列表。
- [x] 实现API最小增量、DTO完整性和旧hash兼容；所有状态/成本入口重核。
- [x] 主控新增兼容schema迁移：nullable、状态依赖完整性、日期有效域、现有ACTIVE唯一及所有外键保持；实库约束测试（23/23，零跳过，含全迁移新建库）。
- [x] UI支持留空长期及资料待补齐提示、内部号自动生成、元分/选填订单号与银行文本；保存成功只读恢复仍有效（28/28，TypeScript通过）。
- [x] 在隔离库及实际组件验证，独立审阅与成本/文件权限回归；最终BaaS/合作商实库回归15/15通过。起月与逐车付款日已由用户确认并写入封存计划。

### Task 3: 合作商资料关联与初始化工具

- [x] 确认新增资料关联与有效合作协议区别；采用DRAFT关联，不伪造文件或分润。额外后台pending投影及回归完成。
- [x] 已批准当前里程更正的专用ADMIN命令，保留普通reserved编辑守卫；来源/CAS/幂等/未交付保护经独立复审，实库/HTTP及车辆回归34/34通过。
- [x] 封存逐行预览和去重匹配，含保留的未知年款车型、新增80车、已有3车补充、83BaaS资料草稿及主体关联。
- [x] 合成映射20项、最终确认4项、执行器11项测试通过；663/663请求经实际DTO校验，独立完整模拟通过，无真实数据入测试夹具。
- [x] 审阅精确生产变更后执行663步写入，逐步读回并完成全量字段核验；保留源表、候选、执行日志与最终回读证据。

### Task 4: 集成与交付

- [x] 冻结改动、构建、独立审阅、隔离库迁移及相关业务回归完成；API/Admin TypeScript通过，发布工具80项测试通过。
- [x] 当前宁达发布 `20261031-vehicle-inventory-v1`，63项迁移及健康检查通过；资料初始化完成，现有订单/产品/套餐及公开车辆集合与执行前一致。
- [x] 交付83辆车（80新增、3补充）、15条车型档案（14组来源车型及保留的1条未登记年款记录）、83份BaaS草稿、80待补协议关联及原3有效关联。2条缺VIN车辆暂缓；37份BaaS起月留空，11份需补租赁资料；小程序生产继续暂停。

## 完成证据（2026-10-31）

- 封存导入计划SHA256：`9cdcd85ac324a3ff2342ff2a3828c5b5f9de25a614d649dbcd041035627a98ca`。
- 正式执行返回 `verified:true`，车辆83、车型15、合作商83、BaaS83、待补协议关联80、有效关联3、成本及成本计划均0。
- 全量回读逐字段核验、文件下载哈希核验及既有业务保护核验已通过；私有证据在 `.runtime/ninda/vehicle-inventory-init-20261031/execute/`，不纳入Git。
- 线上浏览器确认车辆台账显示83条且正常加载；抽查新车辆资产资料字段及独立BaaS页签，缺失起月/租金按未登记展示，合同为草稿。
- 导入完成后再次检查发布状态：运行健康、维护关闭、无待处置异常。未发布小程序生产版本。
