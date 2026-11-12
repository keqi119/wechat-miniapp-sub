# 车辆合作商来源纠正 Implementation Plan

> 主控按项目既有授权直接执行计划；分工人员仅修改各自文件，主控统一发布与生产数据执行。

**Goal:** 按用户指定J列匹配车辆合作商并在台账准确展示登记关系及协议状态。

**Architecture:** 复用现有主体及DRAFT协议API；补后台车辆只读投影；私有封存匹配计划后正常API写入并完整回读。

**Tech Stack:** Node.js、Python只读XLSX、NestJS/Prisma、React。

**Spec:** `docs/superpowers/specs/2026-11-03-vehicle-partner-source-design.md`。

## Global Constraints

仅本项目写入，不改源表，不访问旧业务库；不编造协议、比例、日期，不启用协议或外部账号；不触及原件归档、资产、保险、BaaS及订单事实。后台RBAC、CAS、幂等、事务和审计保持。发布冻结基线窄差异，无关电子签改动不带入。

## Review Focus

- 合并J单元格只能应用明确范围；空白不得任意继承。
- VIN/车牌冲突、重复名、现有效归属冲突不能静默覆盖。
- 旧DRAFT应移除误配车辆，不能仅新增造成多主体候选。
- 最新非草稿、暂停主体、历史版本不参与登记投影；非授权岗位不接收新字段。
- 成功写入后读回失败必须保留回执，不自动重复POST或更换幂等键。

### Task 1: 源表与实时基线

- [x] 只读提取指定页、J列原值与合并范围，固化SHA和行号。
- [x] 读取当前83车及合作商/协议详情；生成逐车匹配与异常清单，复核旧有效关系。

### Task 2: 后台车辆资料关联投影

**Files:** `apps/api/src/vehicles/admin-query.ts`、新增同目录专用helper及`apps/api/test/vehicle-partner-registration.test.ts`。

**Interface:** spec定义的cooperationRegistration；已有cooperationOwner与有效筛选语义保持。

- [x] 先写并运行失败测试：最新草稿、合并同主体、不同主体冲突、有效关系优先/冲突、暂停排除、列表详情一致与非授权岗位隐藏。
- [x] 实现按一次查询/批量映射复用的只读投影，不在每辆车循环读取全部主体。
- [x] 执行相关车辆投影回归与API类型检查，独立审阅。

### Task 3: 台账与详情显示

**Files:** `apps/admin/src/App.tsx`、`vehicle-workspace.tsx`、新增`vehicle-cooperation.tsx`及专用测试。

**Interface:** 消费Task2字段；使用共享组件统一有效/待补/冲突/未登记的显示。

- [x] 先写并运行四状态及兼容旧DTO的失败测试。
- [x] 实现台账及详情显示，保持现有表格视觉；有效关系与待补资料文案明确。
- [x] 验证组件、相关工作区回归及TypeScript，审阅最终差异。

### Task 4: 封存匹配与受控执行

**Files:** `.runtime/vehicle-partner-20261103/`，不纳入Git。

- [x] 生成不可变计划、原有草稿移除及新资料关联，固定源/基线摘要和幂等键。
- [x] 合成测试覆盖同名歧义、错VIN、已有有效冲突、移除后重配、版本漂移、故障停止与重复执行阻断；使用实际生产DTO校验请求。
- [x] 审查准确变更范围后，主控按计划正常API逐步执行与回读。

### Task 5: 发布与最终核验

- [x] 从当前生产冻结基线构建仅本轮变更，验证并发布当前宁达API及后台，不迁移数据库。
- [x] 回读源表匹配车辆的资料关联及台账投影，原有效协议与其他业务不变；验证缺来源及冲突列表。
- [x] 交付真实匹配数量、合作商数量、剩余缺项及结果报告。
