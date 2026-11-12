# BaaS列表输入与下拉筛选（Phase2 2026-11-05）

GET /api/admin/baas-contracts 保留 vehicleId/status/page/pageSize 与 baas-contracts.read（ADMIN/OPERATIONS/FINANCE）权限。keyword仅查询该合同车辆的VIN或车牌，不再混合合同号、provider、supplierOrderNumber。下列四项可自由输入或使用真实选项：

| contains参数 | 下拉精确参数 | 实际字段 |
| --- | --- | --- |
| provider | providerExact | VehicleBaasContract.provider 电池出租方 |
| lesseeName | lesseeNameExact | VehicleBaasContract.lesseeName 实际承租人，不取车辆登记人 |
| brand | brandExact | Vehicle.brand |
| model | modelExact | Vehicle.model，与品牌共同限定 |

普通参数为不区分大小写contains，Exact为原值精确相等；同项不可同时传两种模式。不传表示不限，空字符串、数组、未知query或冲突模式返回400。所有条件与既有vehicleId范围取交集，同一where用于全库查询及count，再分页。NULL不按空字符串或未知名称匹配。

GET /api/admin/baas-contracts/filter-options?vehicleId=&brandExact=（或brand=）保持相同read权限，返回最小{providers:string[],brands:string[],models:[{brand,model}],lessees:string[]}。选项来自当前可读vehicleId范围的全部合同真实字段，去重、排序并排除空值；models按给定品牌关联筛选，其余目录保持该车辆范围全量，方便改选。只返回必要名称，不返回银行账户、信用代码、登记人或合同内容。

列表既有batteryPackage字段即电池规格，lesseeName即实际承租人；本增量不新增数据模型、迁移、费用或支付行为。资金32文件及schema/73迁移保持v3 SHA。
